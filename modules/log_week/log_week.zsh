log_week() {
    # Get the last monday's date, unless it _is_ monday.
    if [[ $(date +%u) -eq 1 ]]; then
        LOG_DATE=$(date +%Y-%m-%d)
    else
        LOG_DATE=$(date -d "last monday" +%Y-%m-%d)
    fi

    LOG_DIR="$HOME/Documents/WorkLogs"
    LOG_FILE="$LOG_DIR/$LOG_DATE-worklog.md"

    mkdir -p "$LOG_DIR"

    $EDITOR "$LOG_FILE"
}
