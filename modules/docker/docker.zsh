warn_is_installed docker

# Usage: d4i [-f: force]
# Description: Delete all docker images
# option -f is required to delete images that are in use
function d4i() {
        # read -f option
        while getopts ":f" opt; do
               case $opt in
                       f) FORCE=1 ;;
                       \?) echo "Invalid option: -$OPTARG" >&2 ;;
               esac
        done

        if [[ $FORCE -eq 1 ]]; then
                docker image prune --force
        else
                docker image prune
        fi
}

# Usage: d4v [-f: force]
# Description: Delete all docker volumes
# option -f is required to delete volumes that are in use
function d4v() {
        # read -f option
        while getopts ":f" opt; do
               case $opt in
                       f) FORCE=1 ;;
                       \?) echo "Invalid option: -$OPTARG" >&2 ;;
               esac
        done

        if [[ $FORCE -eq 1 ]]; then
                docker volume prune --force
        else
                docker volume prune
        fi
}

# Usage: d4n [-f: force]
# Description: Delete all docker networks
# option -f is required to delete networks that are in use
function d4n() {
        # read -f option
        while getopts ":f" opt; do
               case $opt in
                       f) FORCE=1 ;;
                       \?) echo "Invalid option: -$OPTARG" >&2 ;;
               esac
        done

        if [[ $FORCE -eq 1 ]]; then
                docker network prune --force
        else
                docker network prune
        fi
}

# Usage: d4c [-f: force]
# Description: Delete all docker containers
# option -f is required to delete containers that are in use
function d4c() {
        # read -f option
        while getopts ":f" opt; do
               case $opt in
                       f) FORCE=1 ;;
                       \?) echo "Invalid option: -$OPTARG" >&2 ;;
               esac
        done

        if [[ $FORCE -eq 1 ]]; then
                docker container prune --force
        else
                docker container prune
        fi
}

# Usage: d4r [-f: force]
# Description: Delete volumes, networks and containers. keep images
# option -f is required to delete resources that are in use
function d4r() {
        # read -f option
        while getopts ":f" opt; do
               case $opt in
                       f) FORCE=1 ;;
                       \?) echo "Invalid option: -$OPTARG" >&2 ;;
               esac
        done

        if [[ $FORCE -eq 1 ]]; then
                d4v -f
                d4n -f
                d4c -f
        else
                d4v 
                d4n
                d4c
        fi
}

# Usage: docker-cleanup
# Description: Delete docker containers, images, volumes and networks
function docker-cleanup {      
        while getopts "fa:" opt; do
               case $opt in
                       f) FORCE=1 ;;
                       a) NUMBER=$OPTARG ;;
                       \?) echo "Invalid option: -$OPTARG" >&2 ;;
               esac
        done

        # check if any containers are running
        if [[ $(docker ps -a -q) ]]; then
                # ask for comfirmation if we're not forcing
                if [[ $FORCE -ne 1 ]]; then
                        # ask for confirmation
                        echo -n -e "\e[1;31mAre you sure you want to remove all containers? [y/N]: \e[0m"
                        read confirm

                        # check user input
                        if [[ $confirm != "y" && $confirm != "Y" ]]; then
                                echo "Aborting..."
                                return
                        fi
                fi

                # warn user we're removing all containers
                echo -e "\e[1;31mRemoving all containers\e[0m"
                echo -e "\e[1;31mThis will take a few seconds...\e[0m"

                # remove all containers
                # print which command we're running
                echo "running: docker rm -f $(docker ps -a -q)"
                docker rm -f $(docker ps -a -q)

                # tell user we're done
                echo -e "\e[1;32mDone!\e[0m"

                # print a blank line
                echo ""
        fi

        # set value of choice to number if it's set
        if [[ $NUMBER -ne 0 ]]; then
                choice=$NUMBER
        else
                # print list of options
                echo "1) Delete all containers"
                echo "2) Delete all images"
                echo "3) Delete all volumes"
                echo "4) Delete all networks"
                echo "5) Delete all containers, volumes and networks (keep images)"
                echo "6) Delete all containers, volumes and networks (keep images) (force)"
                echo "7) Delete everything"
                echo "8) Delete everything (force)"

                # print a prompt in
                echo -n -e "\e[1;32mEnter your choice: \e[0m"
                # read user input
                read choice
        fi

        # check user input
        case $choice in
                1) d4c ;;
                2) d4i ;;
                3) d4v ;;
                4) d4n ;;
                5) d4r ;;
                6) d4r -f;;
                7) docker system prune ;;
                8) docker system prune -a --force ;;
                *) echo "Invalid choice" ;;
        esac
}