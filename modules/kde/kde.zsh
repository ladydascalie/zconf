rename_desktops() {
    # 1. Get the list of internal IDs from KWin
    # This returns a cleaned array of IDs
    local ids=($(qdbus6 org.kde.KWin /VirtualDesktopManager org.kde.KWin.VirtualDesktopManager.desktops | tr -d '"' | tr ',' '\n'))

    local count=${#ids[@]}
    echo "Syncing $count desktops..."

    for i in {1..$count}; do
        local id=${ids[$i]}

        # Update the config file for persistence
        kwriteconfig6 --file kwinrc --group Desktops --key "Name_$i" "$i"

        # Update the UI live via DBus
        qdbus6 org.kde.KWin /VirtualDesktopManager org.kde.KWin.VirtualDesktopManager.setDesktopName "$id" "$i"
    done

    echo "UI and Config synchronized."
}
