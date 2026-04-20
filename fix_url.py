import re

files = ['app.js', 'submit.html', 'admin.html']
# The ACTUAL URL found in the files
old_url = 'kggcyurkabnxtqfzfzfqexsb.supabase.co'
# The CORRECT URL from user's JWT
new_url = 'kggcyurkabnxtqfzfqex.supabase.co'

for fname in files:
    path = f'c:\\Users\\vilOO\\OneDrive\\桌面\\MAYAO Message Box 2\\{fname}'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    count = content.count(old_url)
    print(f'{fname}: found {count} occurrences')
    if count > 0:
        content = content.replace(old_url, new_url)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f'{fname}: replaced successfully')
    else:
        print(f'{fname}: no replacement needed')
    print()
