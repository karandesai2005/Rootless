# Airmon-ng Firejail profile
# Known gap: monitor mode may require CAP_NET_RAW / raw socket access.
# caps.drop all is intentional here; if start fails at runtime, evaluate
# cap.keep net_raw with explicit justification — do not grant silently.

caps.drop all
noroot
novideo
nosound
nonewprivs
protocol unix,inet,inet6
private-bin airmon-ng
private-tmp
net none