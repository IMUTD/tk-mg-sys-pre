CREATE TABLE admin_identity_verification (
  user_id uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified','verifying','verified','rejected','error','unbound')),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  current_attempt_id uuid,
  encrypted_name text,
  encrypted_number text,
  masked_name text,
  masked_number text,
  cert_no_hmac text,
  hmac_key_version text,
  last_error_code text,
  verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'verified' AND encrypted_name IS NOT NULL AND encrypted_number IS NOT NULL AND cert_no_hmac IS NOT NULL AND hmac_key_version IS NOT NULL AND masked_name IS NOT NULL AND masked_number IS NOT NULL AND verified_at IS NOT NULL) OR (status <> 'verified' AND encrypted_name IS NULL AND encrypted_number IS NULL AND cert_no_hmac IS NULL AND hmac_key_version IS NULL AND masked_name IS NULL AND masked_number IS NULL AND verified_at IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX admin_identity_verified_hmac_unique ON admin_identity_verification(cert_no_hmac) WHERE status = 'verified';
--> statement-breakpoint
CREATE TABLE identity_verification_attempt (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  binding_version integer NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text,
  status text NOT NULL CHECK (status IN ('verifying','verified','rejected','error','superseded')),
  provider text NOT NULL DEFAULT 'aliyun',
  provider_request_id text,
  provider_code text,
  provider_biz_code text,
  error_code text,
  consent_version text NOT NULL,
  consented_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL,
  deadline_at timestamptz NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  finished_at timestamptz,
  UNIQUE(user_id, idempotency_key)
);
--> statement-breakpoint
CREATE INDEX identity_attempt_user_started ON identity_verification_attempt(user_id, started_at);
CREATE INDEX identity_attempt_started ON identity_verification_attempt(started_at);
CREATE INDEX identity_attempt_processing_lease ON identity_verification_attempt(lease_expires_at) WHERE status = 'verifying';
--> statement-breakpoint
CREATE TABLE identity_password_failure (
  actor_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX identity_password_failure_actor_time ON identity_password_failure(actor_id, attempted_at);
--> statement-breakpoint
CREATE UNIQUE INDEX identity_unbind_idempotency_unique ON audit_event(actor_id, target, (metadata->>'idempotencyKey')) WHERE action = 'identity.unbind';
--> statement-breakpoint
CREATE FUNCTION invalidate_identity_attempt_on_user_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.enabled IS DISTINCT FROM NEW.enabled OR OLD.role IS DISTINCT FROM NEW.role OR OLD.provisioned_by IS DISTINCT FROM NEW.provisioned_by THEN
    UPDATE admin_identity_verification SET status = 'error', version = version + 1, current_attempt_id = NULL, last_error_code = 'identity_actor_changed', updated_at = now() WHERE user_id = NEW.id AND status = 'verifying';
    UPDATE identity_verification_attempt SET status = 'superseded', error_code = 'identity_actor_changed', finished_at = now() WHERE user_id = NEW.id AND status = 'verifying';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER app_user_invalidate_identity_attempt AFTER UPDATE OF enabled, role, provisioned_by ON app_user FOR EACH ROW EXECUTE FUNCTION invalidate_identity_attempt_on_user_change();
