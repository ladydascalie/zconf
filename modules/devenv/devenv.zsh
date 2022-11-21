function devenv() {
	SESSION="$USER"

	if [ ! "$(tmux has-session -t "$SESSION")" ]; then
	tmux attach-session -t "$SESSION"
	fi

	tmux new-session -d -s "$SESSION"
	tmux split-window -h
	tmux select-pane -t 1
	tmux split-window -v

	# top row
	tmux select-pane -t 0
	tmux send-keys 'cd ~/Code/Lootlocker/dev.env' C-m
	tmux send-keys 'docker compose up -d' C-m
	tmux send-keys 'clear' C-m

	tmux select-pane -t 1
	tmux send-keys 'cd ~/Code/Lootlocker/go-backend' C-m
	echo "Waiting until mysql comes online"

	tries=0
	while true; do
		((tries+=1)) && (( tries > 10 )) && echo "Failed to connect to mysql" && exit 1
		health=$(docker inspect ll-mysql --format "{{json .State.Health.Status}}")
		if [[ $health == '"healthy"' ]]; then
			break
		fi
		echo "mysql not yet online on try $tries/10"
		sleep 2
	done
	tmux send-keys "mage -v dev:run" C-m

	tmux select-pane -t 2
	tmux send-keys 'cd ~/Code/Lootlocker/ll-frontend' C-m
	tmux send-keys 'npm run dev:local' C-m

	tmux select-pane -t 0

	tmux attach-session -t "$SESSION"
}

function startDevApps() {
	code # open vscode.
	postman &>/dev/null & # open postman.
	datagrip &>/dev/null & # open datagrip.
	resp &>/dev/null & # open resp.app redis client.
}
