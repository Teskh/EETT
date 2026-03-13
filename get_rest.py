with open('/home/devuser/Code/Spec Sheets/Frontend/src/pages/MaterialDashboardPage.tsx', 'r') as f:
    content = f.read()

start = content.find('  return (\n    <div className="-m-6 lg:-m-10 h-[100dvh]')
if start != -1:
    end = content.find('  );\n}\n\nfunction SortableHeader')
    print(content[start:end+4])
