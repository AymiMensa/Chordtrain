with open(r'c:\Users\user\Desktop\Monday_Cat_Hotel\mondaycathotel\public\games\echoes-of-the-grid\client\src\game\levels.ts', 'r', encoding='utf-8') as f:
    text = f.read()

import re
pos = text.find('RAW_CAMPAIGN_LEVELS')
print("Position of RAW_CAMPAIGN_LEVELS:", pos)
lines = text[pos-100:pos+2000]
print(lines[:1500])
