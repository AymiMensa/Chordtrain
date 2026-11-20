import re

with open(r'c:\Users\user\Desktop\Monday_Cat_Hotel\mondaycathotel\public\games\echoes-of-the-grid\client\src\game\levels.ts', 'r', encoding='utf-8') as f:
    levels_ts = f.read()

with open(r'c:\Users\user\Desktop\Monday_Cat_Hotel\mondaycathotel\public\games\echoes-of-the-grid\client\src\game\precomputedSolutions.ts', 'r', encoding='utf-8') as f:
    precomp_ts = f.read()

# Let's inspect PLAYABLE_LEVELS definition
# In levels.ts: RAW_CAMPAIGN_LEVELS = [...]
# Let's find all level IDs in RAW_CAMPAIGN_LEVELS
matches = re.findall(r'id:\s*["\']([^"\']+)["\']', levels_ts)
print(f"Total IDs found: {len(matches)}")
for i, lid in enumerate(matches[:20]):
    in_p = f'"{lid}"' in precomp_ts or f"'{lid}'" in precomp_ts
    print(f"Index {i} (LV{i+1}): id={lid}, precomputed={in_p}")
