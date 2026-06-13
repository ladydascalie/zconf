{
	"$schema": "https://opencode.ai/config.json",
	"model": "deepseek/deepseek-v4-pro",
	"small_model": "deepseek/deepseek-v4-flash",
	"lsp": true,
	"agent": {
		"conductor": {
			"prompt": "{file:~/.config/opencode/agents/conductor.md}",
			"model": "deepseek/deepseek-v4-flash",
			"mode": "primary",
			"description": "The only agent you will interact with directly",
			"permission": {
				"read": "allow",
				"edit": "deny",
				"bash": "deny"
			}
		},
		"plan": {
			"prompt": "{file:~/.config/opencode/agents/plan.md}",
			"model": "deepseek/deepseek-v4-pro",
			"variant": "think-max",
			"mode": "subagent",
			"description": "High-level architecture planning with max reasoning",
			"permission": {
				"read": "allow",
				"edit": "deny",
				"bash": "allow"
			}
		},
		"build": {
			"prompt": "{file:~/.config/opencode/agents/build.md}",
			"model": "deepseek/deepseek-v4-pro",
			"variant": "think-high",
			"mode": "subagent",
			"description": "Implementation with high reasoning",
			"permission": {
				"read": "allow",
				"edit": "allow",
				"bash": "ask"
			}
		},
		"task": {
			"prompt": "{file:~/.config/opencode/agents/build.md}",
			"model": "deepseek/deepseek-v4-flash",
			"variant": "think-high",
			"mode": "subagent",
			"description": "Fast execution for simple coding tasks",
			"permission": {
				"read": "allow",
				"edit": "allow",
				"bash": "ask"
			}
		}
	},
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
			"enabled": true,
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
		}
	}
}
