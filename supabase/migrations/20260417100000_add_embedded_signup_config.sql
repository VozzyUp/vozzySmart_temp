-- Adiciona chave para armazenar o Config ID do Meta Embedded Signup
INSERT INTO settings (key, value) VALUES ('meta_config_id', '')
ON CONFLICT (key) DO NOTHING;
