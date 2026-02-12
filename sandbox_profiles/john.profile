# sandbox_profiles/john.profile

include /etc/firejail/disable-common.inc

quiet
noroot

# Restrict executable visibility to john only
private-bin john

# Allow john runtime configs and rules
whitelist /usr/share/john
whitelist /etc/john

# Allow rockyou list for dictionary attacks
whitelist /usr/share/wordlists/rockyou.txt

# Minimal process/device isolation
private-dev
protocol unix
