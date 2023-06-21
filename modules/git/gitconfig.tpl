[user]
        name = Benjamin Cable
        email = op://Personal/Benjamin Cable/Internet Details/email
        signingKey = op://Keychain/GPG Master Key/add more/Signing Key
[core]
        editor = vim
        excludesfile = ~/.gitignore
[commit]
        gpgSign = true
[credential "https://github.com"]
        helper = 
        helper = !/usr/bin/gh auth git-credential
[credential "https://gist.github.com"]
        helper = 
        helper = !/usr/bin/gh auth git-credential
[init]
        defaultBranch = main
[filter "lfs"]
        clean = git-lfs clean -- %f
        smudge = git-lfs smudge -- %f
        process = git-lfs filter-process
        required = true
[push]
        autoSetupRemote = true
[pull]
        rebase = true
[credential]
        helper = cache --timeout=86400
[diff]
        tool = smerge
[rerere]
        enabled = true
