with open('c:/Users/user/Desktop/Monday_Cat_Hotel/mondaycathotel/public/games/echoes-of-the-grid/client/src/game/precomputedSolutions.ts', 'r', encoding='utf-8') as f:
    text = f.read()
import re
keys = re.findall(r'\"([^\"]+)\":\s*\[', text)
print('Precomputed solution keys:', len(keys), keys)
