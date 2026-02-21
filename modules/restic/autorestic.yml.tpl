version: 2

backends:
  hetzner:
    type: sftp
    path: {{ op://Private/Hetzer Storage Box/username }}@{{ op://Private/Hetzer Storage Box/username }}.your-storagebox.de:restic-repo
    env:
      RESTIC_PASSWORD_FILE: /home/b/.config/autorestic/.restic-password
    options:
      sftp.command: "ssh -p 23 -o PubkeyAcceptedAlgorithms=ssh-ed25519 -o IdentitiesOnly=yes -o IdentityFile=~/.ssh/personal.pub {{ op://Private/Hetzer Storage Box/username }}@{{ op://Private/Hetzer Storage Box/username }}.your-storagebox.de -s sftp"

locations:
  home:
    from: /home/b
    to:
      - hetzner
    cron: "0 */6 * * *"
    forget: "yes"
    options:
      forget:
        keep-hourly: 5
        keep-daily: 7
        keep-weekly: 4
        keep-monthly: 6
      backup:
        exclude:
          - .cache
          - .local/share/Steam
          - .local/share/Trash
          - node_modules
          - .npm
          - .cargo
