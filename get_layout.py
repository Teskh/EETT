with open('/home/devuser/Code/Spec Sheets/Frontend/src/pages/MaterialDashboardPage.tsx', 'r') as f:
    content = f.read()

start = content.find('  return (\n    <div className="-m-6 lg:-m-10')
if start == -1:
    print("Could not find start")
else:
    end = content.find('  );\n}\n\nfunction SortableHeader')
    print(content[start:end+4])
