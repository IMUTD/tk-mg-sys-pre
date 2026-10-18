#!/usr/bin/env bash
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
test_root=$(mktemp -d "${TMPDIR:-/tmp}/tk-mg-deploy-contract-XXXXXX")
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
  const ci = Bun.YAML.parse(await Bun.file(process.argv[4]).text());
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const imageStep = (job) => job.steps.find((step) => step.uses?.startsWith("docker/build-push-action@"));
  const productionBuild = imageStep(workflow.jobs.build);
  assert(workflow.jobs.deploy["timeout-minutes"] >= 35, "Deploy job must cover image downloads, activation and cleanup");
  const deployStep = workflow.jobs.deploy.steps.find((step) => step.name === "Upload release and deploy over SSH");
  await Bun.write(process.argv[5], deployStep.run);
  assert(!productionBuild.with["cache-to"], "Merged-PR builds must not export to the read-only GitHub Actions cache");
  assert(!productionBuild["continue-on-error"] && !workflow.jobs.build["continue-on-error"], "Image build and push failures must block deployment");
  const ciBuildJob = ci.jobs["image-build"];
  assert(ciBuildJob, "PR CI must validate production image builds");
  const ciBuild = imageStep(ciBuildJob);
  assert(JSON.stringify(ciBuildJob.strategy.matrix.target) === JSON.stringify(workflow.jobs.build.strategy.matrix.target), "CI must build every production image target");
  for (const input of ["context", "file", "target", "platforms", "cache-from"]) {
    assert(ciBuild.with[input] === productionBuild.with[input], `CI and Deploy image ${input} differ`);
  }
  assert(ciBuild.with.push === false && ciBuild.with.load === true, "CI must load images locally without publishing them");
  assert(!ciBuild.with["cache-to"] && !ciBuild["continue-on-error"] && !ciBuildJob["continue-on-error"], "CI image validation must preserve read-only caching and fail on build errors");
  assert(JSON.stringify(ciBuildJob.permissions) === JSON.stringify({contents: "read"}), "CI image builds must not require package write permissions");
  assert(ci.jobs.quality.steps.some((step) => step.run === "bash infra/deploy.test.sh"), "PR CI must run deployment contracts");
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
' "$test_root/compose.json" "$script_dir/../.github/workflows/deploy.yml" "$tag_one" "$script_dir/../.github/workflows/ci.yml" "$test_root/workflow.sh"

mkdir "$test_root/bin"
export DEPLOY_TEST_LOG="$test_root/docker.log"
cat > "$test_root/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$DEPLOY_TEST_LOG"
case "$*" in
  *"config --images"*)
    [[ "${DEPLOY_TEST_FAILURE:-}" != config-images ]] || exit 1
    [[ "${DEPLOY_TEST_FAILURE:-}" != empty-images ]] || exit 0
    for target in api web postgres redis; do printf 'ghcr.io/imutd/tk-mg-sys-%s:%s\n' "$target" "$IMAGE_TAG"; done ;;
  "image inspect "*) [[ "${DEPLOY_TEST_FAILURE:-}" != missing-image ]] ;;
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
deploy() { bash "$root/releases/$1/infra/deploy.sh" "$root" "$@"; }
if deploy latest 2>/dev/null; then echo "Accepted a mutable image tag" >&2; exit 1; fi
[[ ! -f "$DEPLOY_TEST_LOG" ]]
deploy "$tag_one" > "$test_root/first.log"
[[ $(cat "$root/current-release") = "$tag_one" ]]
[[ ! -f "$root/previous-release" ]]
[[ -z $(ls -A "$root/backups") ]]
for failure in missing-image config-images empty-images; do
  : > "$DEPLOY_TEST_LOG"
  export DEPLOY_TEST_FAILURE="$failure"
  if deploy "$tag_two" --preloaded > /dev/null 2>&1; then echo "Ignored $failure before activation" >&2; exit 1; fi
  [[ $(cat "$root/current-release") = "$tag_one" ]]
  [[ ! -f "$root/pending-release" ]]
  [[ -z $(ls -A "$root/backups") ]]
  ! grep -Eq 'bootstrap pull| up | stop |pg_dump| initialize' "$DEPLOY_TEST_LOG"
done
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
if deploy "$tag_two" --preloaded > /dev/null 2>&1; then echo "Preloaded deployment ignored lock" >&2; exit 1; fi
unset DEPLOY_TEST_LOCKED
deploy "$tag_two" > "$test_root/second.log"
[[ $(cat "$root/current-release") = "$tag_two" ]]
[[ $(cat "$root/previous-release") = "$tag_one" ]]
: > "$DEPLOY_TEST_LOG"
bash "$script_dir/rollback.sh" "$root" > "$test_root/rollback.log"
[[ $(cat "$root/current-release") = "$tag_one" ]]
! grep -q 'initialize\|bootstrap pull' "$DEPLOY_TEST_LOG"
! grep -q 'down' "$DEPLOY_TEST_LOG"
: > "$DEPLOY_TEST_LOG"
deploy "$tag_two" --preloaded > "$test_root/preloaded.log"
[[ $(cat "$root/current-release") = "$tag_two" ]]
[[ $(grep -c '^image inspect ghcr.io/imutd/tk-mg-sys-' "$DEPLOY_TEST_LOG") -eq 4 ]]
! grep -q 'bootstrap pull' "$DEPLOY_TEST_LOG"
grep -q 'run --rm --no-deps --pull never initialize' "$DEPLOY_TEST_LOG"

# Execute the workflow shell against a temporary server with mocked transports.
cat > "$test_root/bin/ssh" <<'EOF'
#!/usr/bin/env bash
while [[ $# -gt 1 ]]; do shift; done
bash -c "$1"
EOF
cat > "$test_root/bin/scp" <<'EOF'
#!/usr/bin/env bash
for destination; do :; done
cp release.tar.gz "${destination#*:}"
EOF
cat > "$test_root/bin/git" <<'EOF'
#!/usr/bin/env bash
tar -czf release.tar.gz -C "$DEPLOY_TEST_SOURCE" infra
EOF
cat > "$test_root/bin/timeout" <<'EOF'
#!/usr/bin/env bash
set -eu
[[ "$1" = --signal=TERM && "$2" = --kill-after=30s ]]
budget=$3
shift 3
printf 'timeout:%s %s\n' "$budget" "$*" >> "$DEPLOY_TEST_LOG"
if [[ "$budget" = 20m && "${DEPLOY_TEST_FAILURE:-}" = pull-timeout ]]; then exit 124; fi
"$@"
EOF
chmod 700 "$test_root/bin/"*
export DEPLOY_TEST_SOURCE="$script_dir/.."
export DEPLOY_HOST=test.invalid DEPLOY_USER=deploy DEPLOY_PORT=22 DEPLOY_PATH="$root"
export DEPLOY_WEB_PORT=8080 ADMIN_EMAIL=admin@example.com GHCR_USER=test GHCR_TOKEN=test-only
export DEPLOY_SSH_KEY=test-only DEPLOY_KNOWN_HOSTS=test-only
export RUNNER_TEMP="$test_root" GITHUB_STEP_SUMMARY="$test_root/summary"
export COMMIT_SHA=${tag_one#sha-}
mkdir "$test_root/runner"
for failure in pull pull-timeout; do
  : > "$DEPLOY_TEST_LOG"
  export DEPLOY_TEST_FAILURE="$failure"
  status=0
  (cd "$test_root/runner" && bash "$test_root/workflow.sh") > "$test_root/workflow-$failure.log" 2>&1 || status=$?
  [[ "$status" -ne 0 ]]
  if [[ "$failure" = pull-timeout ]]; then [[ "$status" -eq 124 ]]; fi
  [[ $(cat "$root/current-release") = "$tag_two" ]]
  [[ ! -f "$root/pending-release" && ! -f "$root/releases/$tag_one/.docker/config.json" ]]
  ! grep -Eq 'timeout:12m| up | stop |pg_dump| initialize' "$DEPLOY_TEST_LOG"
done
unset DEPLOY_TEST_FAILURE
: > "$DEPLOY_TEST_LOG"
(cd "$test_root/runner" && bash "$test_root/workflow.sh") > "$test_root/workflow-success.log" 2>&1
[[ $(cat "$root/current-release") = "$tag_one" ]]
[[ $(grep -c '^compose .*bootstrap pull$' "$DEPLOY_TEST_LOG") -eq 1 ]]
grep -q '^timeout:20m docker compose .*bootstrap pull$' "$DEPLOY_TEST_LOG"
grep -q '^timeout:12m bash .*deploy.sh .* --preloaded$' "$DEPLOY_TEST_LOG"
[[ $(grep -c '^image inspect ghcr.io/imutd/tk-mg-sys-' "$DEPLOY_TEST_LOG") -eq 4 ]]
cmp "$test_root/original.env" "$root/shared/.env"
echo "Deployment contracts passed: main merge gates, separate download/activation budgets, preloaded images, credentials, isolation, first start, backup, failure, lock and rollback"
