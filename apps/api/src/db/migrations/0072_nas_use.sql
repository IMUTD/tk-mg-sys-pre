create table nas_use (
  administrator_id uuid not null references app_user (id),
  object_key text not null,
  use_count integer not null default 0,
  primary key (administrator_id, object_key),
  constraint nas_use_count_check check (use_count >= 0),
  constraint nas_use_key_check check (char_length(object_key) between 1 and 1024)
);
