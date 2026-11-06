ALTER TABLE device_instance ADD COLUMN IF NOT EXISTS webrtc_tcp integer DEFAULT 0 NOT NULL;
ALTER TABLE device_instance ADD COLUMN IF NOT EXISTS webrtc_udp integer DEFAULT 0 NOT NULL;
