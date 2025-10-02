log_week() {
    # Get the last monday's date, unless it _is_ monday.
    if [[ $(date +%u) -eq 1 ]]; then
        LOG_DATE=$(date +%Y-%m-%d)
    else
        LOG_DATE=$(date -d "last monday" +%Y-%m-%d)
    fi

    LOG_DIR="$HOME/Documents/WorkLogs"
    YEAR=$(date -d "$LOG_DATE" +%Y)
    MONTH=$(date -d "$LOG_DATE" +%B | tr '[:upper:]' '[:lower:]')
    WEEKNUM=$(date -d "$LOG_DATE" +%V)
    LOG_FILE="$LOG_DIR/${YEAR}-${MONTH}-week-${WEEKNUM}.md"

    mkdir -p "$LOG_DIR"

    $EDITOR "$LOG_FILE"
}
