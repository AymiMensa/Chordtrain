f=open('C:/Users/user/Desktop/Chord_Train_New/client/public/KIMIchord_trees_fixed.html','r',encoding='utf-8');c=f.read();f.close()
# Fix broken string literal on lines 3776-3777 where \\n was replaced with actual newline
c=c.replace(\"join('\\\\r\\n');body='\\\\ufeff'+csv\", \"join('\\\\r\\\\n');body='\\\\ufeff'+csv\")
# Also fix any remaining cases where \\n became actual newline in string literals
import re
c=re.sub(r\"join\\('\\\\r\\n';\", \"join('\\\\r\\\\n');\", c)
f=open('C:/Users/user/Desktop/Chord_Train_New/client/public/KIMIchord_trees_fixed.html','w',encoding='utf-8');f.write(c);f.close()
print('Fixed CSV string literal')