with open(r'c:\Users\user\Desktop\Monday_Cat_Hotel\mondaycathotel\public\games\echoes-of-the-grid\client\src\game\levels.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i in range(520, min(600, len(lines))):
    print(f"{i+1}: {lines[i]}", end='')
