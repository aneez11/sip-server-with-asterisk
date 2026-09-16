#!/bin/sh
# Test the PA AGI script by feeding it a simulated AGI request.
printf 'agi_channel: PJSIP/2000-00000001\r\nagi_callerid: "Office Phone" <2000>\r\nagi_extension: 9100\r\n\r\n' \
  | env PA_API_SECRET="pa-internal-trigger-secret" PA_API_BASE="http://api:3001" \
      bash /etc/asterisk/agi/pa-launch.sh 9100
echo "--- rc=$? ---"
echo "--- log ---"
cat /var/log/asterisk/pa-agi.log 2>/dev/null | tail -3
