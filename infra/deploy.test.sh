#!/usr/bin/env bash
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT
root="$test_root/deployment"
tag_one=sha-1111111111111111111111111111111111111111
tag_two=sha-2222222222222222222222222222222222222222
bash "$script_dir/setup-deploy-env.sh" "$root" admin@example.com > "$test_root/setup.log"
cp "$root/shared/.env" "$test_root/original.env"
if bash "$script_dir/setup-deploy-env.sh" "$root" admin@example.com 2>/dev/null; then
  echo "Setup overwrote credentials" >&2; exit 1
fi
cmp "$test_root/original.env" "$root/shared/.env"
[[ $(sed -n 's/^SECRET_ENCRYPTION_KEY=//p' "$root/shared/.env" | tr -d '\n' | wc -c) -eq 32 ]]
! grep -q 'ADMIN_BOOTSTRAP_PASSWORD=' "$test_root/setup.log"
IMAGE_TAG="$tag_one" docker compose --env-file "$root/shared/.env" -f "$script_dir/compose.prod.yml" --profile bootstrap config --format json > "$test_root/compose.json"
bun -e '
  const c = await Bun.file(process.argv[1]).json();
  const workflow = Bun.YAML.parse(await Bun.file(process.argv[2]).text());
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  assert(JSON.stringify(workflow.on) === JSON.stringify({pull_request: {branches: ["main"], types: ["closed"]}}), "Deploy must only listen for PRs closed against main");
  const github = {event_name: "pull_request", ref: "refs/heads/main", event: {action: "closed", pull_request: {merged: true, base: {ref: "main"}}}};
  const needs = {verify: {result: "success"}, "production-ci": {result: "success"}, build: {result: "success"}};
  const allows = (job, context = github, results = needs, enabled = "true", cancelled = false) => {
    const expression = workflow.jobs[job].if;
    assert(typeof expression === "string", `${job} must have an explicit deployment gate`);
    return Boolean(new Function("github", "needs", "vars", "cancelled", `return (${expression.replace(/^\$\{\{\s*|\s*\}\}$/g, "")});`)(context, results, {DEPLOY_ENABLED: enabled}, () => cancelled));
  };
  for (const job of ["verify", "production-ci", "build", "deploy"]) {
    assert(allows(job), `${job} rejects a successful main merge`);
    for (const eventName of ["push", "workflow_dispatch", "pull_request_target"]) {
      assert(!allows(job, {...github, event_name: eventName}), `${job} permits ${eventName}`);
    }
    for (const [action, merged, branch, ref] of [
      ["opened", false, "main", "refs/pull/1/merge"],
      ["synchronize", false, "main", "refs/pull/1/merge"],
      ["closed", false, "main", "refs/pull/1/merge"],
      ["closed", true, "develop", "refs/heads/develop"],
      ["closed", true, "main", "refs/heads/feat/github-deploy-test"],
    ]) {
      assert(!allows(job, {...github, ref, event: {action, pull_request: {merged, base: {ref: branch}}}}), `${job} permits ${action}/${merged}/${branch}/${ref}`);
    }
  }
  for (const dependency of ["verify", "production-ci"]) {
    for (const result of ["failure", "cancelled", "skipped"]) {
      assert(!allows("build", github, {...needs, [dependency]: {result}}), `Build permits ${dependency} ${result}`);
    }
  }
  for (const result of ["failure", "cancelled", "skipped"]) {
    assert(!allows("deploy", github, {...needs, build: {result}}), `Deploy permits build ${result}`);
  }
  for (const enabled of ["false", "", "TRUE"]) assert(!allows("deploy", github, needs, enabled), "Deploy ignores DEPLOY_ENABLED");
  for (const job of ["build", "deploy"]) assert(!allows(job, github, needs, "true", true), `${job} permits a cancelled workflow`);
  const targets = workflow.jobs.build.strategy.matrix.target;
  if (c.services.postgres.ports?.length || c.services.redis.ports?.length) throw new Error("Database ports exposed");
  for (const name of ["api", "worker", "web", "initialize", "postgres", "redis"]) {
    const target = ["initialize", "worker"].includes(name) ? "api" : name;
    const expected = `ghcr.io/imutd/tk-mg-sys-${target}:${process.argv[3]}`;
    if (c.services[name].image !== expected) throw new Error(`${name} must use the release image from GHCR`);
    if (!targets.includes(target)) throw new Error(`Workflow does not publish ${target}`);
    if (c.services[name].build) throw new Error("Server must not build images");
  }
  if (JSON.stringify(c.services.worker.command) !== JSON.stringify(["bun", "apps/worker/src/main.ts"])) throw new Error("Shared worker image must start the worker entry point");
  if (c.services.initialize.depends_on.api) throw new Error("Initialization waits for API readiness");
  if (c.services.api.environment.AUTH_COOKIE_SECURE !== "false") throw new Error("HTTP cookies not configured");
' "$test_root/compose.json" "$script_dir/../.github/workflows/deploy.yml" "$tag_one"

mkdir "$test_root/bin"
export DEPLOY_TEST_LOG="$test_root/docker.log"
cat > "$test_root/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$DEPLOY_TEST_LOG"
case "$*" in
  *"bootstrap pull"*) [[ "${DEPLOY_TEST_FAILURE:-}" != pull ]] ;;
  *"run --rm --no-deps --pull never initialize"*) [[ "${DEPLOY_TEST_FAILURE:-}" != initialize ]] ;;
  *"pg_dump"*) echo "test-backup" ;;
esac
EOF
cat > "$test_root/bin/curl" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"http_code"*) printf '401' ;;
  *) printf '{"status":"ok"}' ;;
esac
EOF
cat > "$test_root/bin/flock" <<'EOF'
#!/usr/bin/env bash
[[ "${DEPLOY_TEST_LOCKED:-}" != true ]]
EOF
chmod 700 "$test_root/bin/"*
export PATH="$test_root/bin:$PATH"
for tag in "$tag_one" "$tag_two"; do
  mkdir -p "$root/releases/$tag/infra"
  cp "$script_dir/deploy.sh" "$script_dir/compose.prod.yml" "$script_dir/smoke-test.sh" "$root/releases/$tag/infra/"
done
deploy() { bash "$root/releases/$1/infra/deploy.sh" "$root" "$1"; }
if deploy latest 2>/dev/null; then echo "Accepted a mutable image tag" >&2; exit 1; fi
[[ ! -f "$DEPLOY_TEST_LOG" ]]
deploy "$tag_one" > "$test_root/first.log"
[[ $(cat "$root/current-release") = "$tag_one" ]]
[[ ! -f "$root/previous-release" ]]
[[ -z $(ls -A "$root/backups") ]]
export DEPLOY_TEST_FAILURE=pull
if deploy "$tag_two" > /dev/null 2>&1; then echo "Ignored pull failure" >&2; exit 1; fi
[[ $(cat "$root/current-release") = "$tag_one" ]]
export DEPLOY_TEST_FAILURE=initialize
if deploy "$tag_two" > /dev/null 2>&1; then echo "Ignored initialization failure" >&2; exit 1; fi
[[ $(cat "$root/current-release") = "$tag_one" ]]
[[ -n $(ls -A "$root/backups") ]]
unset DEPLOY_TEST_FAILURE
: > "$DEPLOY_TEST_LOG"
bash "$script_dir/rollback.sh" "$root" > "$test_root/recover.log"
[[ $(cat "$root/current-release") = "$tag_one" ]]
[[ ! -f "$root/pending-release" ]]
! grep -q 'initialize\|bootstrap pull' "$DEPLOY_TEST_LOG"
export DEPLOY_TEST_LOCKED=true
if deploy "$tag_two" > /dev/null 2>&1; then echo "Ignored deployment lock" >&2; exit 1; fi
unset DEPLOY_TEST_LOCKED
deploy "$tag_two" > "$test_root/second.log"
[[ $(cat "$root/current-release") = "$tag_two" ]]
[[ $(cat "$root/previous-release") = "$tag_one" ]]
: > "$DEPLOY_TEST_LOG"
bash "$script_dir/rollback.sh" "$root" > "$test_root/rollback.log"
[[ $(cat "$root/current-release") = "$tag_one" ]]
! grep -q 'initialize\|bootstrap pull' "$DEPLOY_TEST_LOG"
! grep -q 'down' "$DEPLOY_TEST_LOG"
echo "Deployment contracts passed: main merge gates, credentials, isolation, first start, backup, failure, lock and rollback"
