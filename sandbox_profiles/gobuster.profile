# Gobuster Firejail profile
include /etc/firejail/disable-common.inc

caps.drop all
netfilter
noroot
novideo
nosound
nodvd
notv
nou2f
nonewprivs
protocol unix,inet,inet6

private-bin gobuster
private-tmp
private-dev

whitelist /usr/share/wordlists/
read-only /usr/share/wordlists/