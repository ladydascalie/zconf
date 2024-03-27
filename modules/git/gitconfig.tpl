[user]
        name = Benjamin Cable
        email = cable.benjamin@protonmail.com
	signingkey = {{op://Personal/personal/public key }}
[core]
        editor = vim
        excludesfile = ~/.gitignore
	fsmonitor = true
[init]
        defaultBranch = main
[commit]
        gpgSign = true
[filter "lfs"]
        clean = git-lfs clean -- %f
        smudge = git-lfs smudge -- %f
        process = git-lfs filter-process
        required = true
[push]
        autoSetupRemote = true
[pull]
        rebase = true
[rebase]
	autoStash = true
[diff]
        tool = smerge
	algorithm = histogram
[rerere]
        enabled = true
[gpg]
	format = ssh
[gpg "ssh"]
	program = "/opt/1Password/op-ssh-sign"
	allowedSignersFile = ~/.ssh/allowed_signers
[credential]
        helper = cache --timeout=86400
