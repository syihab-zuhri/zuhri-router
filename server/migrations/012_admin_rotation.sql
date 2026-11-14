-- Admin can replace the authenticator secret: the new secret is held as pending until one code from it has been verified.
alter table admin_credential add column pending_totp_enc text;
