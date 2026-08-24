{
	"$schema": "https://opencode.ai/config.json",
	"model": "openrouter/deepseek/deepseek-v4-flash",
	"small_model": "openrouter/deepseek/deepseek-v4-flash",
	"lsp": true,
	"permission": {
		"task": "allow",
		"skill": {
			"todotxt": "allow"
		}
	},
	"mcp": {
		"apidog_game_api": {
			"enabled": true,
			"type": "local",
			"command": [
				"npx",
				"-y",
				"apidog-mcp-server@latest",
				"--project=446496"
			],
			"environment": {
				"APIDOG_ACCESS_TOKEN": "{{op://Env/OpenCode API Keys/APIDOG_ACCESS_TOKEN}}"
			}
		},
		"apidog_admin_api": {
			"enabled": true,
			"type": "local",
			"command": [
				"npx",
				"-y",
				"apidog-mcp-server@latest",
				"--project-id=446495"
			],
			"environment": {
				"APIDOG_ACCESS_TOKEN": "{{op://Env/OpenCode API Keys/APIDOG_ACCESS_TOKEN}}"
			}
		},
		"grafana": {
			"enabled": true,
			"type": "local",
			"command": ["uvx", "mcp-grafana"],
			"environment": {
				"GRAFANA_URL": "https://lootlocker.grafana.net",
				"GRAFANA_SERVICE_ACCOUNT_TOKEN": "{{op://Env/OpenCode API Keys/GRAFANA_SERVICE_ACCOUNT_TOKEN}}"
			}
		},
		"playwright": {
			"enabled": false,
			"type": "local",
			"command": ["npx", "-y", "@playwright/mcp@latest"]
		},
		"firefox-devtools": {
			"enabled": true,
			"type": "local",
			"command": [
				"npx",
				"-y",
				"@mozilla/firefox-devtools-mcp@latest",
				"--viewport",
				"1440x900"
			]
		},
		"specification-website": {
			"enabled": true,
			"type": "remote",
			"url": "https://mcp.specification.website/mcp"
		}
	}
}
