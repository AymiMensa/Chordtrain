with open(r'c:\Users\user\Desktop\Monday_Cat_Hotel\mondaycathotel\public\games\echoes-of-the-grid\client\src\game\levels.ts', 'r', encoding='utf-8') as f:
    text = f.read()

import re
m = re.search(r'const RAW_CAMPAIGN_LEVELS\s*:\s*Level\[\]\s*=\s*\[([\s\S]*?)\];', text)
if m:
    levels_raw = m.group(1)
    # find all objects or level ids
    ids = re.findall(r'id:\s*["\']([^"\']+)["\']', levels_raw)
    print(f"Total RAW_CAMPAIGN_LEVELS: {len(ids)}")
    for i, lid in enumerate(ids):
        print(f"Index {i} (LV{i+1}): {lid}")
else:
    print("RAW_CAMPAIGN_LEVELS not matched directly, searching...")
    matches = [line for line in text.splitlines() if 'RAW_CAMPAIGN_LEVELS' in line]
    print(matches)
