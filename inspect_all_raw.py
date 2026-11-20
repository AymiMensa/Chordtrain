with open(r'c:\Users\user\Desktop\Monday_Cat_Hotel\mondaycathotel\public\games\echoes-of-the-grid\client\src\game\levels.ts', 'r', encoding='utf-8') as f:
    text = f.read()

pos = text.find('const RAW_CAMPAIGN_LEVELS')
pos2 = text.find('export const PLAYABLE_LEVELS', pos)
print(text[pos:pos2])
