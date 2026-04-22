from __future__ import annotations

import json
from html import escape


def render_layout(*, title: str, active_nav: str, content: str, extra_scripts: list[str] | None = None) -> str:
    extra_scripts = extra_scripts or []
    nav = [
        _nav_link("/", "Launcher", active_nav == "home"),
        _nav_link("/catalog", "Database Editor", active_nav == "catalog"),
        _nav_link("/projects", "Projects", active_nav == "projects"),
    ]
    scripts = "".join(f'<script src="{escape(path)}" defer></script>' for path in extra_scripts)
    return f"""<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{escape(title)} | Spec Sheets</title>
    <link rel="stylesheet" href="/static/css/app.css">
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/@phosphor-icons/web"></script>
    <link href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@100..900&display=swap" rel="stylesheet">
    <script>
        tailwind.config = {{
            darkMode: 'class',
            theme: {{
                extend: {{
                    fontFamily: {{
                        sans: ['Geist', 'sans-serif'],
                        mono: ['Geist Mono', 'monospace'],
                    }},
                    colors: {{
                        accent: {{
                            400: '#fbbf24',
                            500: '#f59e0b',
                            900: '#78350f',
                            950: '#451a03',
                        }},
                        zinc: {{
                            950: '#09090b',
                            900: '#18181b',
                            800: '#27272a',
                            700: '#3f3f46',
                            600: '#52525b',
                            500: '#71717a',
                            400: '#a1a1aa',
                            300: '#d4d4d8',
                            200: '#e4e4e7',
                            100: '#f4f4f5',
                            50: '#fafafa',
                        }}
                    }}
                }}
            }}
        }}
    </script>
    <style>
      .liquid-glass {{
          background: rgba(24, 24, 27, 0.4);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 8px 32px -4px rgba(0, 0, 0, 0.5);
      }}
      .ambient-glow {{
          position: fixed;
          top: -20vh;
          right: -10vw;
          width: 70vw;
          height: 70vh;
          background: radial-gradient(circle, rgba(245,158,11,0.06) 0%, rgba(9,9,11,0) 70%);
          pointer-events: none;
          z-index: 0;
      }}
      body {{ font-family: 'Geist', sans-serif; background-color: #09090b; color: #e4e4e7; }}
    </style>
  </head>
  <body class="min-h-[100dvh] font-sans selection:bg-accent-500/30 selection:text-accent-400 overflow-x-hidden relative">
    <div class="ambient-glow"></div>
    <div class="flex h-screen overflow-hidden relative z-10">
      <nav class="w-16 border-r border-white/10 bg-zinc-950/80 backdrop-blur-md flex flex-col items-center py-6 shrink-0 z-50">
        <div class="w-8 h-8 rounded-lg bg-accent-500 flex items-center justify-center text-zinc-950 font-bold mb-8 shadow-[0_0_15px_rgba(245,158,11,0.4)]">
          <i class="ph-bold ph-database text-xl"></i>
        </div>
        <div class="flex flex-col gap-4 w-full px-2">
            {''.join(nav)}
        </div>
      </nav>
      <main class="flex-1 flex flex-col h-full relative">
        <header class="h-16 border-b border-white/5 bg-zinc-950/50 backdrop-blur-xl flex items-center justify-between px-6 shrink-0 z-40">
          <div class="flex items-center gap-4">
            <div class="font-mono text-xs text-zinc-500 tracking-widest uppercase">Spec Sheets</div>
            <div class="h-4 w-px bg-white/10"></div>
            <h1 class="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              {escape(title)}
              <span class="w-2 h-2 rounded-full bg-accent-500 shadow-[0_0_8px_rgba(245,158,11,0.6)] animate-pulse"></span>
            </h1>
          </div>
        </header>
        <div class="flex-1 overflow-y-auto overflow-x-hidden p-6 lg:p-10">
          {content}
        </div>
      </main>
    </div>
    {scripts}
  </body>
</html>"""


def render_home_page() -> str:
    cards = """
    <section class="hero-grid">
      <article class="hero-card accent-catalog">
        <p class="card-kicker">Central Catalog</p>
        <h2>Database editor views</h2>
        <p>Browse nested categories, inspect reusable item and accessory templates, review attribute definitions, and manage linked accessory categories without the legacy text-field hacks.</p>
        <a class="button-link" href="/catalog">Open database editor</a>
      </article>
      <article class="hero-card accent-projects">
        <p class="card-kicker">Projects</p>
        <h2>Project viewing workspace</h2>
        <p>Open grouped projects, inspect subtype trees, and browse project instances by category with material applicability and BOM state preserved.</p>
        <a class="button-link" href="/projects">Open projects</a>
      </article>
    </section>
    <section class="notes-grid">
      <article class="panel">
        <h3>What is implemented</h3>
        <ul class="clean-list">
          <li>Single normalized schema for categories, components, materials, projects, instances, links, and BOM entries.</li>
          <li>Seeded demo dataset that demonstrates linked accessories, subtype BOM rows, and blank-versus-zero quantity behavior.</li>
          <li>Read-oriented JSON endpoints ready for a later typed React client.</li>
        </ul>
      </article>
      <article class="panel">
        <h3>Current scope</h3>
        <ul class="clean-list">
          <li>Catalog view with lightweight create actions for categories and components.</li>
          <li>Project board with create action and project detail browsing.</li>
          <li>No exports, comments, auth, dashboard, or ERP integration yet.</li>
        </ul>
      </article>
    </section>
    """
    return render_layout(title="Launcher", active_nav="home", content=cards)


def render_catalog_page(data: dict, selected_category_id: int | None) -> str:
    selected = data["selected"]
    
    # Data Density Widget (Summary Stats)
    summary_html = ""
    for label, value in (
        ("Categories", data["summary"]["categories"]),
        ("Components", data["summary"]["components"]),
        ("Materials", data["summary"]["materials"]),
    ):
        summary_html += f"""
        <div class="flex flex-col gap-1 border-b border-white/5 pb-3 last:border-0 last:pb-0">
            <div class="flex justify-between items-end">
                <span class="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">{escape(label)}</span>
            </div>
            <div class="font-mono text-2xl font-bold text-white tracking-tighter">
                {value}
            </div>
        </div>
        """

    selected_block = "<div class='liquid-glass rounded-2xl p-6 text-center text-zinc-500 font-mono text-sm'>No category selected.</div>"
    if selected is not None:
        child_chips = "".join(
            f'<a class="px-3 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-semibold text-zinc-300 transition-colors" href="/catalog?category_id={child["id"]}">{escape(child["name"])} <span class="text-zinc-500 font-mono text-[10px] ml-2">{escape(child["scope"])}</span></a>'
            for child in selected["child_categories"]
        ) or "<p class='text-xs text-zinc-500 font-mono'>No child categories.</p>"
        
        linked_lines = "".join(
            f'<div class="px-2 py-1 bg-black/40 border border-white/5 rounded text-xs text-zinc-400 font-mono">{escape(category["name"])}</div>' for category in selected["linked_categories"]
        ) or "<p class='text-xs text-zinc-500 font-mono'>None</p>"
        
        component_cards = "".join(_render_catalog_component_card(component) for component in selected["components"]) or "<div class='p-8 text-center text-zinc-500 font-mono text-sm border border-white/5 bg-white/5 rounded-lg'>No components yet.</div>"
        
        link_checkboxes = "".join(
            f"""
            <label class="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer hover:text-white transition-colors">
              <input type="checkbox" name="linked_category_ids" value="{target['id']}" {"checked" if target['id'] in selected['linked_category_ids'] else ""} class="rounded border-white/10 bg-black/40 text-accent-500 focus:ring-accent-500/50">
              <span class="font-mono text-xs">{escape(target['name'])}</span>
            </label>
            """
            for target in data["link_targets"]
        ) or "<p class='text-xs text-zinc-500 font-mono'>No targets available.</p>"
        
        selected_block = f"""
        <div class="flex flex-col gap-6">
            <!-- Header Block -->
            <div class="flex items-end justify-between border-b border-white/10 pb-4">
                <div>
                    <h2 class="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
                        {escape(selected['name'])}
                        <span class="px-2 py-0.5 border border-white/10 bg-white/5 rounded text-[10px] font-mono text-zinc-400 align-middle uppercase">{escape(selected['scope'])}</span>
                    </h2>
                    <p class="text-sm text-zinc-500 mt-1">{escape(selected['description'] or 'No description provided.')}</p>
                </div>
            </div>

            <!-- Meta Data Grid -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="liquid-glass rounded-xl p-5">
                    <h3 class="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2"><i class="ph-bold ph-folders text-zinc-400"></i> Children</h3>
                    <div class="flex flex-wrap gap-2">{child_chips}</div>
                </div>
                <div class="liquid-glass rounded-xl p-5 border-accent-500/20">
                    <h3 class="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2"><i class="ph-bold ph-link text-accent-500"></i> Linked Categories</h3>
                    <div class="flex flex-wrap gap-2">{linked_lines}</div>
                </div>
            </div>

            <!-- Forms Grid -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <form class="liquid-glass rounded-xl p-5 flex flex-col gap-4" method="post" action="/catalog/categories">
                    <h3 class="text-xs font-bold text-zinc-200 uppercase tracking-widest"><i class="ph-bold ph-folder-plus text-zinc-400 mr-2"></i> Add Child Category</h3>
                    <input type="hidden" name="parent_id" value="{selected['id']}">
                    <div class="space-y-3">
                        <input name="name" required placeholder="Category Name" class="w-full bg-black/40 border border-white/10 rounded p-2 text-sm text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono">
                        <textarea name="description" rows="2" placeholder="Description" class="w-full bg-black/40 border border-white/10 rounded p-2 text-sm text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"></textarea>
                        <select name="scope" class="w-full bg-black/40 border border-white/10 rounded p-2 text-sm text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono">
                            <option value="item">Item</option>
                            <option value="accessory">Accessory</option>
                            <option value="mixed">Mixed</option>
                        </select>
                    </div>
                    <button type="submit" class="mt-auto px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-semibold text-white transition-all w-full">Create Category</button>
                </form>

                <form class="liquid-glass rounded-xl p-5 flex flex-col gap-4" method="post" action="/catalog/components">
                    <h3 class="text-xs font-bold text-zinc-200 uppercase tracking-widest"><i class="ph-bold ph-cube text-zinc-400 mr-2"></i> Add Component</h3>
                    <input type="hidden" name="category_id" value="{selected['id']}">
                    <div class="space-y-3">
                        <div class="flex gap-2">
                            <input name="name" required placeholder="Name" class="w-2/3 bg-black/40 border border-white/10 rounded p-2 text-sm text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono">
                            <input name="short_name" placeholder="SKU" class="w-1/3 bg-black/40 border border-white/10 rounded p-2 text-sm text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono">
                        </div>
                        <div class="flex gap-2">
                            <select name="component_type" class="w-1/2 bg-black/40 border border-white/10 rounded p-2 text-sm text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono">
                                <option value="item">Item</option>
                                <option value="accessory">Accessory</option>
                            </select>
                            <input name="unit_type" placeholder="Unit (m2, set)" class="w-1/2 bg-black/40 border border-white/10 rounded p-2 text-sm text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono">
                        </div>
                        <textarea name="description" rows="2" placeholder="Description" class="w-full bg-black/40 border border-white/10 rounded p-2 text-sm text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"></textarea>
                    </div>
                    <button type="submit" class="mt-auto px-4 py-2 bg-accent-500 hover:bg-accent-400 text-zinc-950 border border-transparent rounded-lg text-xs font-bold shadow-[0_0_15px_rgba(245,158,11,0.2)] transition-all w-full">Create Component</button>
                </form>

                <form class="liquid-glass rounded-xl p-5 flex flex-col gap-4" method="post" action="/catalog/categories/{selected['id']}/links">
                    <h3 class="text-xs font-bold text-zinc-200 uppercase tracking-widest"><i class="ph-bold ph-plugs text-zinc-400 mr-2"></i> Rules</h3>
                    <div class="flex-1 bg-black/20 border border-white/5 rounded-lg p-3 max-h-[200px] overflow-y-auto space-y-2">
                        {link_checkboxes}
                    </div>
                    <button type="submit" class="mt-auto px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-semibold text-white transition-all w-full">Save Rules</button>
                </form>
            </div>

            <!-- Components List -->
            <div>
                <div class="flex items-center justify-between mb-4">
                    <h3 class="text-lg font-bold text-white flex items-center gap-2">
                        <i class="ph-bold ph-stack text-zinc-400"></i> Components
                    </h3>
                    <div class="text-xs font-mono text-zinc-500">{len(selected['components'])} instances</div>
                </div>
                <div class="w-full border border-white/10 rounded-xl overflow-hidden bg-zinc-900/50 backdrop-blur-sm">
                    {component_cards}
                </div>
            </div>
        </div>
        """

    content = f"""
    <div class="max-w-[1600px] mx-auto grid grid-cols-1 xl:grid-cols-12 gap-6">
        <!-- Left Sidebar -->
        <div class="xl:col-span-3 space-y-6">
            <!-- Navigation -->
            <div class="liquid-glass rounded-2xl p-4 flex flex-col h-[500px]">
                <div class="flex items-center justify-between mb-4">
                    <h2 class="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                        <i class="ph-bold ph-tree-structure"></i> Taxonomy
                    </h2>
                    <i class="ph-bold ph-magnifying-glass text-zinc-600"></i>
                </div>
                <div class="flex-1 overflow-y-auto pr-2" data-tree-filter-target>
                    {_render_catalog_tree(data['tree'], selected_category_id or (selected['id'] if selected else None))}
                </div>
            </div>

            <!-- Widget -->
            <div class="liquid-glass rounded-2xl p-5 flex flex-col gap-4">
                <div class="flex justify-between items-end mb-2">
                    <span class="text-xs text-zinc-500 uppercase tracking-widest font-bold">Total Scope</span>
                    <i class="ph-bold ph-chart-bar text-zinc-400"></i>
                </div>
                {summary_html}
            </div>
        </div>

        <!-- Main Content -->
        <div class="xl:col-span-9">
            {selected_block}
        </div>
    </div>
    """
    
    return render_layout(
        title="Database Editor",
        active_nav="catalog",
        content=content,
        extra_scripts=["/static/js/catalog.js"],
    )


def render_projects_page(data: dict) -> str:
    columns = []
    ordered_statuses = ["template", "execution", "finished"]
    
    status_icons = {
        "template": "ph-blueprint",
        "execution": "ph-hammer",
        "finished": "ph-check-circle"
    }

    for status in ordered_statuses:
        cards = "".join(
            f"""
            <div class="bg-black/40 border border-white/10 rounded-xl p-4 group hover:border-accent-500/50 transition-colors flex flex-col gap-3">
                <div>
                    <a class="text-sm font-bold text-white mb-1 group-hover:text-accent-400 transition-colors inline-flex" href="/projects/{project['id']}">{escape(project['name'])}</a>
                </div>
                <div class="flex items-center justify-between border-t border-white/5 pt-3 mt-auto">
                    <div class="flex items-center gap-2 font-mono text-[10px] text-zinc-500">
                        <i class="ph-bold ph-stack"></i> {project['instance_count']} instances
                    </div>
                </div>
            </div>
            """
            for project in data["grouped_projects"][status]
        ) or "<div class='text-center p-6 border border-dashed border-white/10 rounded-xl text-xs font-mono text-zinc-500'>No projects</div>"
        
        columns.append(
            f"""
            <div class="liquid-glass rounded-2xl p-5 flex flex-col h-[700px]">
                <div class="flex items-center justify-between mb-6 border-b border-white/10 pb-4">
                    <h2 class="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
                        <i class="ph-bold {status_icons[status]} text-zinc-400"></i> {escape(data['status_labels'][status])}
                    </h2>
                    <span class="px-2 py-0.5 bg-black/40 border border-white/10 rounded text-[10px] font-mono text-zinc-400">{len(data['grouped_projects'][status])}</span>
                </div>
                <div class="flex-1 overflow-y-auto pr-2 space-y-3">
                    {cards}
                </div>
            </div>
            """
        )

    content = f"""
    <div class="max-w-[1600px] mx-auto flex flex-col gap-6">
        <!-- Top Board Info & Create -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <form class="liquid-glass rounded-2xl p-6 flex flex-col gap-4" method="post" action="/projects">
                <h2 class="text-sm font-bold text-zinc-200 uppercase tracking-widest flex items-center gap-2"><i class="ph-bold ph-folder-plus text-zinc-400"></i> Create Project</h2>
                <div class="space-y-3">
                    <input name="name" required placeholder="Project Name" class="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-sm text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono">
                    <select name="status" class="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-sm text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono">
                        <option value="template">Project Template</option>
                        <option value="execution">Execution Project</option>
                        <option value="finished">Finished Project</option>
                    </select>
                </div>
                <button type="submit" class="mt-2 px-4 py-2.5 bg-accent-500 hover:bg-accent-400 text-zinc-950 border border-transparent rounded-lg text-sm font-bold shadow-[0_0_15px_rgba(245,158,11,0.2)] transition-all flex justify-center items-center gap-2">
                    <i class="ph-bold ph-plus"></i> Create Project
                </button>
            </form>

            <div class="md:col-span-2 liquid-glass rounded-2xl p-8 flex flex-col justify-center relative overflow-hidden group">
                <div class="absolute top-0 right-0 w-32 h-32 bg-accent-500/5 blur-3xl rounded-full"></div>
                <p class="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2"><i class="ph-bold ph-info text-accent-500 mr-1"></i> Project Board</p>
                <h2 class="text-2xl font-bold text-white tracking-tight mb-2">Project lifecycle preserved</h2>
                <p class="text-sm text-zinc-400 max-w-xl leading-relaxed">The legacy statuses remain explicit domain states. The viewer workspace keeps templates, execution projects, and finished work together in one model while still allowing status-based browsing.</p>
            </div>
        </div>

        <!-- Kanban Board -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            {''.join(columns)}
        </div>
    </div>
    """
    return render_layout(title="Projects", active_nav="projects", content=content)


def render_project_detail_page(data: dict) -> str:
    project = data["project"]
    sections = []
    category_links = []
    for category in data["categories"]:
        indent = "&nbsp;" * category["depth"] * 4
        category_links.append(
            f'<a href="#category-{category["id"]}" class="w-full block text-left px-2 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors rounded" data-category-link>{indent}{escape(category["name"])}</a>'
        )
        component_options = "".join(
            f'<option value="{component["id"]}" data-name="{escape(component["name"])}" data-short-name="{escape(component["short_name"] or "")}" data-description="{escape(component["description"] or "")}" data-installation="{escape(component["installation"] or "")}" data-attributes="{escape(json.dumps(component["attributes"]), quote=True)}">{escape(component["name"])} ({escape(component["type"])})</option>'
            for component in category["available_components"]
        )
        create_instance_modal = _render_create_instance_modal(project["id"], category, component_options) if category["available_components"] else ""
        create_instance_action = (
            f'<button type="button" class="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded border border-white/10 text-xs font-semibold transition-colors flex items-center gap-2" data-modal-open="add-instance-{category["id"]}"><i class="ph-bold ph-plus"></i> Add Instance</button>'
            if category["available_components"]
            else "<p class='text-[10px] font-mono text-zinc-500 uppercase tracking-widest'>No reusable components exist</p>"
        )
        instance_cards = "".join(
            _render_project_instance(project["id"], category["id"], instance)
            for instance in category["instances"]
        ) or "<div class='text-center p-6 border border-white/5 bg-white/5 rounded-xl text-xs font-mono text-zinc-500'>No instances in this category.</div>"
        
        linked_categories = "".join(
            f'<span class="px-2 py-1 bg-black/40 border border-white/5 rounded text-[10px] font-mono text-zinc-400">{escape(name)}</span>' for name in category["linked_categories"]
        ) or "<span class='text-[10px] font-mono text-zinc-600'>None</span>"
        
        sections.append(
            f"""
            <div id="category-{category['id']}" class="flex flex-col gap-4 mb-10 scroll-mt-24">
                <div class="flex items-end justify-between border-b border-white/10 pb-4">
                    <div>
                        <h2 class="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
                            {escape(category['name'])}
                            <span class="px-2 py-0.5 border border-white/10 bg-white/5 rounded text-[10px] font-mono text-zinc-400 align-middle uppercase">{escape(category['scope'])}</span>
                        </h2>
                        <div class="flex items-center gap-2 mt-2">
                            <span class="text-xs text-zinc-500 font-mono">Links:</span>
                            {linked_categories}
                        </div>
                    </div>
                    {create_instance_action}
                </div>
                {create_instance_modal}
                <div class="w-full border border-white/10 rounded-xl overflow-hidden bg-zinc-900/50 backdrop-blur-sm">
                    {instance_cards}
                </div>
            </div>
            """
        )

    subtype_tree = "".join(_render_subtype(subtype) for subtype in data["subtypes"]) if data["subtypes"] else "<li class='text-xs font-mono text-zinc-500'>No subtype breakdown defined.</li>"
    auxiliary_rows = "".join(
        f"""
        <tr class="group hover:bg-white/5 transition-colors">
          <td class="px-3 py-3 text-zinc-500 font-mono text-xs">{escape(row['code'])}</td>
          <td class="px-3 py-3 text-zinc-200 font-medium text-sm">{escape(row['name'])}</td>
          <td class="px-3 py-3 text-zinc-400 text-sm">{escape(row['category'] or 'Uncategorized')}</td>
          <td class="px-3 py-3 text-zinc-400 text-sm">{escape(row['subtype'])}</td>
          <td class="px-3 py-3 text-right font-mono text-sm text-accent-400">{row['price']:,.0f}</td>
        </tr>
        """
        for row in data["auxiliary_materials"]
    ) or "<tr><td colspan='5' class='py-4 text-center text-zinc-500 font-mono text-xs'>No auxiliary materials selected.</td></tr>"

    content = f"""
    <!-- Top Hero -->
    <div class="max-w-[1600px] mx-auto mb-6">
        <div class="liquid-glass rounded-2xl p-8 flex justify-between items-end relative overflow-hidden">
            <div class="absolute top-0 right-0 w-64 h-64 bg-accent-500/5 blur-3xl rounded-full"></div>
            <div class="relative z-10">
                <p class="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                    <i class="ph-bold ph-kanban text-accent-500"></i> Project Viewer
                </p>
                <h1 class="text-4xl font-bold text-white tracking-tighter mb-2">{escape(project['name'])}</h1>
            </div>
            <div class="relative z-10 flex items-center gap-4">
                <div class="flex flex-col items-end">
                    <span class="text-[10px] font-mono text-zinc-500 uppercase">Status</span>
                    <span class="px-2 py-1 bg-white/10 text-white rounded text-xs font-semibold">{escape(project['status_label'])}</span>
                </div>
                <div class="flex flex-col items-end">
                    <span class="text-[10px] font-mono text-zinc-500 uppercase">Instances</span>
                    <span class="font-mono text-xl font-bold text-accent-400">{project['instance_count']}</span>
                </div>
            </div>
        </div>
    </div>

    <!-- Main Workspace Grid -->
    <div class="max-w-[1600px] mx-auto grid grid-cols-1 xl:grid-cols-12 gap-6">
        
        <!-- Left Sidebar -->
        <div class="xl:col-span-3 space-y-6">
            <div class="liquid-glass rounded-2xl p-4 flex flex-col h-[60vh] sticky top-24">
                <div class="flex items-center justify-between mb-4">
                    <h2 class="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                        <i class="ph-bold ph-list-magnifying-glass"></i> Categories
                    </h2>
                </div>
                <input id="projectCategorySearch" type="text" placeholder="Filter categories..." class="w-full bg-black/40 border border-white/10 rounded-lg py-1.5 px-3 mb-4 text-sm text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-accent-500/50 transition-all font-mono">
                <div class="flex-1 overflow-y-auto pr-2 space-y-1" data-tree-filter-target>
                    {''.join(category_links)}
                </div>
            </div>

            <div class="liquid-glass rounded-2xl p-5">
                <h3 class="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2"><i class="ph-bold ph-git-branch text-zinc-400"></i> Subtype Tree</h3>
                <ul class="ml-2 border-l border-white/10 pl-3 space-y-1 text-sm text-zinc-400">
                    {subtype_tree}
                </ul>
            </div>
        </div>

        <!-- Right Content Area -->
        <div class="xl:col-span-9 flex flex-col gap-6">
            {''.join(sections)}
            
            <!-- Auxiliary Materials -->
            <div class="mt-8 pt-8 border-t border-white/10">
                <div class="flex items-center justify-between mb-6">
                    <h3 class="text-lg font-bold text-white flex items-center gap-2">
                        <i class="ph-bold ph-tags text-zinc-400"></i> Auxiliary Elements
                    </h3>
                </div>
                <div class="w-full border border-white/10 rounded-xl overflow-hidden bg-black/40">
                    <table class="w-full text-left border-collapse text-sm">
                        <thead class="bg-black/60 border-b border-white/10">
                            <tr>
                                <th class="px-3 py-2 text-zinc-500 font-medium">Code</th>
                                <th class="px-3 py-2 text-zinc-500 font-medium">Name</th>
                                <th class="px-3 py-2 text-zinc-500 font-medium">Category</th>
                                <th class="px-3 py-2 text-zinc-500 font-medium">Subtype</th>
                                <th class="px-3 py-2 text-zinc-500 font-medium text-right">Base Price</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-white/5">
                            {auxiliary_rows}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
    """
    return render_layout(
        title=project["name"],
        active_nav="projects",
        content=content,
        extra_scripts=["/static/js/project_view.js"],
    )


def _render_catalog_tree(nodes: list[dict], selected_category_id: int | None, is_root: bool = True) -> str:
    if not nodes and is_root:
        return "<p class='text-xs text-zinc-500 font-mono'>No categories loaded.</p>"
    elif not nodes:
        return ""
        
    wrapper_class = "space-y-1" if is_root else "ml-5 border-l border-white/10 mt-1 pl-3 space-y-1"
    
    return f"<ul class='{wrapper_class}'>" + "".join(_render_catalog_tree_node(node, selected_category_id, is_root) for node in nodes) + "</ul>"


def _render_catalog_tree_node(node: dict, selected_category_id: int | None, is_root: bool) -> str:
    is_active = node["id"] == selected_category_id
    
    if is_root:
        active_class = "bg-white/5 border border-white/5 text-zinc-200 font-medium" if is_active else "hover:bg-white/5 border border-transparent text-zinc-500 hover:text-zinc-300"
        icon_class = "ph-fill ph-folder-open text-accent-400" if is_active else "ph-fill ph-folder"
        
        link = f"""
        <a class="w-full flex items-center justify-between text-left px-3 py-2 rounded-lg text-sm transition-colors {active_class}" href="/catalog?category_id={node['id']}">
            <span class="flex items-center gap-2"><i class="{icon_class}"></i> {escape(node['name'])}</span>
            <span class="font-mono text-[10px] text-zinc-500">{node['component_count']} items</span>
        </a>
        """
    else:
        active_class = "text-accent-400 font-semibold before:bg-accent-400/50" if is_active else "text-zinc-400 hover:text-zinc-200 before:bg-white/10"
        
        link = f"""
        <a class="w-full block text-left px-2 py-1 text-sm transition-colors relative before:absolute before:w-2 before:h-px before:-left-3 before:top-1/2 {active_class}" href="/catalog?category_id={node['id']}">
            {escape(node['name'])}
        </a>
        """
        
    children = _render_catalog_tree(node["children"], selected_category_id, is_root=False) if node["children"] else ""
    return f"""
    <li data-filter-item>
      {link}
      {children}
    </li>
    """


def _render_catalog_component_card(component: dict) -> str:
    attribute_editor = _render_catalog_attribute_editor(component)

    material_rows = "".join(_render_material_rule(rule) for rule in component["material_rules"]) or "<tr><td colspan='4' class='py-4 text-center text-zinc-500 font-mono text-xs'>No material rules defined.</td></tr>"
    
    icon_class = "ph-flask" if component['type'] == 'accessory' else "ph-wall"
    type_label = "ACCESSORY" if component['type'] == 'accessory' else "ITEM"
    badge_bg = "bg-white/10 text-zinc-300 border-white/20" if component['type'] == 'accessory' else "bg-black/40 text-zinc-400 border-white/10"
    
    return f"""
    <div class="border-b border-white/10 last:border-0">
        <!-- Header -->
        <div class="flex items-center justify-between p-4 bg-black/20 group hover:bg-white/5 transition-colors">
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400">
                    <i class="ph-fill {icon_class}"></i>
                </div>
                <div>
                    <div class="font-bold text-white text-[15px] flex items-center gap-2">
                        {escape(component['name'])}
                        <span class="px-2 py-0.5 border border-white/10 bg-black/40 rounded text-[10px] font-mono text-zinc-500 align-middle ml-2">{escape(component['short_name'] or '')}</span>
                    </div>
                </div>
            </div>
            <div class="flex items-center gap-3">
                <span class="px-2 py-1 {badge_bg} text-[10px] font-bold uppercase tracking-widest border rounded">{type_label}</span>
                <button type="button" class="px-3 py-1.5 text-xs font-semibold text-zinc-300 border border-white/10 bg-white/5 hover:bg-white/10 rounded transition-colors flex items-center gap-2" onclick="this.parentElement.parentElement.nextElementSibling.classList.toggle('hidden')">
                    <i class="ph-bold ph-caret-down"></i> Details
                </button>
            </div>
        </div>

        <!-- Details Container (Hidden by default, toggled by button above) -->
        <div class="hidden border-t border-white/5 bg-black/40 p-4">
            <p class="text-sm text-zinc-400 mb-6">{escape(component['description'] or 'No description provided.')}</p>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <!-- Crud & Meta -->
                <div class="flex flex-col gap-4">
                    <form class="bg-white/5 border border-white/10 rounded-lg p-4 flex flex-col gap-3" method="post" action="/catalog/components/{component['id']}/update">
                        <h6 class="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2"><i class="ph-bold ph-pencil-simple text-zinc-500"></i> Edit Component</h6>
                        <div class="flex gap-2">
                            <input name="name" value="{escape(component['name'])}" required placeholder="Name" class="w-2/3 bg-black/40 border border-white/10 rounded p-1.5 text-xs text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-colors font-mono">
                            <input name="short_name" value="{escape(component['short_name'] or '')}" placeholder="SKU" class="w-1/3 bg-black/40 border border-white/10 rounded p-1.5 text-xs text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-colors font-mono">
                        </div>
                        <div class="flex gap-2">
                            <select name="component_type" class="w-1/2 bg-black/40 border border-white/10 rounded p-1.5 text-xs text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-colors font-mono">
                                <option value="item" {"selected" if component['type'] == 'item' else ""}>Item</option>
                                <option value="accessory" {"selected" if component['type'] == 'accessory' else ""}>Accessory</option>
                            </select>
                            <input name="unit_type" value="{escape(component['unit_type'] or '')}" placeholder="Unit type" class="w-1/2 bg-black/40 border border-white/10 rounded p-1.5 text-xs text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-colors font-mono">
                        </div>
                        <textarea name="description" rows="2" placeholder="Description" class="w-full bg-black/40 border border-white/10 rounded p-1.5 text-xs text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-colors font-mono">{escape(component['description'] or '')}</textarea>
                        <textarea name="installation" rows="2" placeholder="Installation" class="w-full bg-black/40 border border-white/10 rounded p-1.5 text-xs text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-colors font-mono">{escape(component['installation'] or '')}</textarea>
                        <div class="flex justify-between items-center mt-2">
                            <button class="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded text-xs font-semibold transition-colors" type="submit">Save changes</button>
                        </div>
                    </form>
                    
                    <form method="post" action="/catalog/components/{component['id']}/delete" class="flex items-center justify-between bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                        <input type="hidden" name="category_id" value="{component['category_id']}">
                        <span class="text-[10px] text-red-400 font-mono">Deletion blocked if in use.</span>
                        <button class="px-2 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded text-xs font-semibold transition-colors flex items-center gap-1" type="submit"><i class="ph-bold ph-trash"></i> Delete</button>
                    </form>
                </div>

                <!-- Attributes Section -->
                <div>
                    <h6 class="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2"><i class="ph-bold ph-list-dashes text-zinc-600"></i> Attributes</h6>
                    {attribute_editor}
                </div>
            </div>

            <!-- Materials Section -->
            <div>
                <h6 class="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2"><i class="ph-bold ph-boxes text-zinc-600"></i> Material Rules</h6>
                <table class="w-full text-left border-collapse text-sm border border-white/10 rounded overflow-hidden">
                    <thead class="bg-black/60 border-b border-white/10">
                        <tr>
                            <th class="px-3 py-2 text-zinc-500 font-medium w-1/3">Material</th>
                            <th class="px-3 py-2 text-zinc-500 font-medium w-1/4">SKU / Unit</th>
                            <th class="px-3 py-2 text-zinc-500 font-medium text-right w-1/4">Qty Per Unit</th>
                            <th class="px-3 py-2 text-zinc-500 font-medium text-right">Conditions</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white/5 divide-y divide-white/5">
                        {material_rows}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
    """


def _render_catalog_attribute_editor(component: dict) -> str:
    initial_attributes = escape(
        json.dumps(
            [
                {
                    "name": attribute["name"],
                    "value_type": attribute["value_type"],
                    "options": attribute["options"],
                }
                for attribute in component["attributes"]
            ]
        ),
        quote=True,
    )
    return f"""
    <form
        class="flex flex-col gap-3"
        method="post"
        action="/catalog/components/{component['id']}/attributes/update"
        data-attribute-editor
        data-initial-attributes="{initial_attributes}"
    >
        <input type="hidden" name="attributes_json" value="[]" data-attribute-json>
        <div class="flex flex-col gap-3" data-attribute-list></div>
        <div class="flex items-center justify-between gap-3 pt-1">
            <button
                type="button"
                class="px-3 py-1.5 border border-white/10 bg-white/5 hover:bg-white/10 rounded text-xs font-semibold text-zinc-200 transition-colors flex items-center gap-2"
                data-add-attribute
            ><i class="ph-bold ph-plus"></i> Add attribute</button>
            <button
                class="px-3 py-1.5 bg-accent-500/20 hover:bg-accent-500/30 text-accent-400 rounded text-xs font-semibold transition-colors"
                type="submit"
                data-save-attributes
            >Save attribute set</button>
        </div>
        <div class="text-[10px] font-mono text-zinc-500 min-h-4" data-save-status aria-live="polite"></div>
        <p class="text-[10px] text-zinc-500 font-mono">Build attributes as rows and add individual option values inside each select attribute.</p>
        <noscript><div class="text-[10px] text-red-300 font-mono border border-red-500/20 bg-red-500/10 rounded-lg p-3">JavaScript is required for the attribute editor.</div></noscript>
    </form>
    """


def _render_material_rule(rule: dict) -> str:
    conditions = []
    for group in rule["conditions"]:
        clauses = " AND ".join(
            _format_condition(clause)
            for clause in group["clauses"]
        )
        conditions.append(f"<span class='px-1.5 py-0.5 bg-black/40 border border-white/5 rounded text-[10px] font-mono text-zinc-400'>{escape(group['group'])}: {escape(clauses)}</span>")
    condition_list = "".join(conditions) if conditions else "<span class='text-zinc-500 text-xs italic'>Always applies</span>"
    unit_qty = "n/a" if rule["unit_qty_per_unit"] is None else f"{rule['unit_qty_per_unit']}"
    
    return f"""
    <tr class="group hover:bg-white/5 transition-colors">
        <td class="px-3 py-3 text-zinc-200 font-medium text-sm flex flex-col gap-1">
            {escape(rule['material_name'])}
            <span class="text-[10px] text-zinc-500 font-mono">{escape(rule['notes'] or '')}</span>
        </td>
        <td class="px-3 py-3 text-zinc-500 font-mono text-xs">
            {escape(rule['sku'])} <br/> ({escape(rule['unit'] or '-')})
        </td>
        <td class="px-3 py-3 text-right font-mono text-sm text-accent-400">
            {escape(unit_qty)}
        </td>
        <td class="px-3 py-3 text-right flex flex-wrap justify-end gap-1">
            {condition_list}
        </td>
    </tr>
    """


def _render_project_instance(project_id: int, category_id: int, instance: dict) -> str:
    attribute_blocks = "".join(
        f"""
        <div class="mb-4 last:mb-0">
          <h5 class="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2"><i class="ph-bold ph-list-dashes text-zinc-600"></i> {escape(group['name'])} <span class="text-[10px] font-mono text-zinc-600 ml-auto">{escape(group['application_label'] or 'Base')}</span></h5>
          <table class="w-full text-left border-collapse text-sm">
            <tbody class="divide-y divide-white/10">
              {''.join(f'<tr><td class="py-1.5 text-zinc-500 w-1/2">{escape(row["name"])}</td><td class="py-1.5 text-zinc-200 font-mono w-1/2">{escape(row["value"] or "-")}</td></tr>' for row in group['values'])}
            </tbody>
          </table>
        </div>
        """
        for group in instance["attributes"]
    ) or "<p class='text-xs text-zinc-500 font-mono italic'>No attributes loaded.</p>"

    linked_accessories = "".join(
        _render_instance_link_badge(link) for link in instance["linked_accessories"]
    ) or "<span class='text-xs font-mono text-zinc-500'>None</span>"
    linked_to = "".join(
        _render_instance_link_badge(link) for link in instance["linked_to"]
    ) or "<span class='text-xs font-mono text-zinc-500'>Standalone</span>"
    
    material_rows = "".join(_render_bom_material(material) for material in instance["materials"]) or "<div class='text-center py-6 text-xs text-zinc-500 font-mono border border-dashed border-white/10 rounded'>No applicable materials resolved for this instance.</div>"
    
    edit_modal = _render_edit_instance_modal(project_id, category_id, instance)
    
    icon_class = "ph-flask" if instance['type'] == 'accessory' else "ph-wall"
    type_label = "ACCESSORY" if instance['type'] == 'accessory' else "ITEM"
    badge_bg = "bg-white/10 text-zinc-300 border-white/20" if instance['type'] == 'accessory' else "bg-black/40 text-zinc-400 border-white/10"

    sync_is_outdated = instance["sync_state"].get("is_outdated", False)
    sync_label = "Out of sync" if sync_is_outdated else instance["sync_state"]["status"].replace("_", " ")
    sync_color = "text-amber-400" if sync_is_outdated or instance["sync_state"]["status"] != "up_to_date" else "text-green-400"

    return f"""
    <div class="border-b border-white/10 last:border-0">
        <!-- Header -->
        <div class="flex items-center justify-between p-4 bg-black/20 group hover:bg-white/5 transition-colors">
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400">
                    <i class="ph-fill {icon_class}"></i>
                </div>
                <div>
                    <div class="font-bold text-white text-[15px] flex items-center gap-2">
                        {escape(instance['name'])}
                        <span class="px-2 py-0.5 border border-white/10 bg-black/40 rounded text-[10px] font-mono text-zinc-500 align-middle ml-2">{escape(instance['short_name'] or instance['name'])}</span>
                    </div>
                </div>
            </div>
            <div class="flex items-center gap-3">
                <span class="px-2 py-1 {badge_bg} text-[10px] font-bold uppercase tracking-widest border rounded">{type_label}</span>
                <button type="button" class="px-3 py-1.5 text-xs font-semibold text-zinc-300 border border-white/10 bg-white/5 hover:bg-white/10 rounded transition-colors flex items-center gap-2" onclick="this.parentElement.parentElement.nextElementSibling.classList.toggle('hidden')">
                    <i class="ph-bold ph-caret-down"></i> Details
                </button>
            </div>
        </div>

        <!-- Details Container -->
        <div class="hidden border-t border-white/5 bg-black/40 p-4">
            
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <!-- Left Col -->
                <div class="space-y-6">
                    <div>
                        <h6 class="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2"><i class="ph-bold ph-info text-zinc-600"></i> Info</h6>
                        <p class="text-sm text-zinc-300 mb-2">{escape(instance['description'] or 'No description provided.')}</p>
                        <div class="flex items-center gap-4 text-xs font-mono">
                            <span class="text-zinc-400">Unit Amount: <strong class="text-zinc-200">{escape(str(instance['unit_amount']) if instance['unit_amount'] is not None else '-')}</strong></span>
                            <span class="text-zinc-400">Sync: <strong class="{sync_color}">{escape(sync_label)}</strong></span>
                        </div>
                        {"<p class='text-xs text-amber-400 font-mono mt-2'>Catalog definition changed since this instance snapshot was created.</p>" if sync_is_outdated else ""}
                    </div>
                    
                    <div class="bg-white/5 border border-white/10 rounded-lg p-4">
                        <h6 class="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2"><i class="ph-bold ph-plugs text-zinc-600"></i> Relationships</h6>
                        <div class="space-y-2">
                            <div class="flex items-center gap-2"><span class="text-xs text-zinc-500 font-mono w-24">Linked Acc:</span> <div class="flex flex-wrap gap-1">{linked_accessories}</div></div>
                            <div class="flex items-center gap-2"><span class="text-xs text-zinc-500 font-mono w-24">Attached To:</span> <div class="flex flex-wrap gap-1">{linked_to}</div></div>
                        </div>
                    </div>
                    
                    <div>
                        <h6 class="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2"><i class="ph-bold ph-wrench text-zinc-600"></i> Installation</h6>
                        <p class="text-sm text-zinc-400">{escape(instance['installation'] or 'No installation notes.')}</p>
                    </div>

                    <div class="flex items-center gap-3 pt-4 border-t border-white/10">
                        <button type="button" class="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded text-xs font-semibold transition-colors flex items-center gap-2" data-modal-open="edit-instance-{instance['id']}"><i class="ph-bold ph-pencil-simple"></i> Edit Instance</button>
                        {"<button type='button' class='px-3 py-1.5 bg-accent-500/10 hover:bg-accent-500/20 text-accent-400 border border-accent-500/20 rounded text-xs font-semibold transition-colors flex items-center gap-2' data-instance-refresh data-project-id='" + str(project_id) + "' data-instance-id='" + str(instance['id']) + "'><i class='ph-bold ph-arrow-clockwise'></i> Refresh from Catalog</button>" if sync_is_outdated else ""}
                        <form method="post" action="/projects/{project_id}/instances/{instance['id']}/delete" onsubmit="return confirm('Delete this project instance and its project-scoped records?');">
                            <input type="hidden" name="category_id" value="{category_id}">
                            <button class="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded text-xs font-semibold transition-colors flex items-center gap-2" type="submit"><i class="ph-bold ph-trash"></i> Delete</button>
                        </form>
                    </div>
                </div>

                <!-- Right Col: Attributes -->
                <div class="bg-black/40 border border-white/5 rounded-lg p-4">
                    {attribute_blocks}
                </div>
            </div>

            <!-- Materials Table -->
            <div class="border-t border-white/10 pt-6">
                <h6 class="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2"><i class="ph-bold ph-boxes text-zinc-600"></i> Applicable Materials</h6>
                <div class="space-y-4">
                    {material_rows}
                </div>
            </div>
            
        </div>
    </div>
    {edit_modal}
    """


def _render_instance_link_badge(link: dict) -> str:
    label = escape(link["name"])
    if link.get("application_label"):
        label = f"{label} <span class='text-zinc-500 mx-1'>·</span> <span class='text-accent-400'>{escape(link['application_label'])}</span>"
    return f'<span class="px-2 py-0.5 bg-black/40 border border-white/10 rounded text-[10px] font-mono text-zinc-300">{label}</span>'


def _render_create_instance_modal(project_id: int, category: dict, component_options: str) -> str:
    return f"""
    <div class="fixed inset-0 hidden items-center justify-center p-4 z-[100] modal-shell" data-modal="add-instance-{category['id']}" aria-hidden="true">
      <div class="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm modal-backdrop" data-modal-close></div>
      <div class="relative modal-card">
        
        <div class="flex items-start justify-between border-b border-white/10 pb-4 mb-6">
          <div>
            <p class="text-[10px] font-bold text-accent-500 uppercase tracking-widest mb-1 flex items-center gap-2"><i class="ph-bold ph-plus-circle"></i> Create Project Instance</p>
            <h3 class="text-xl font-bold text-white">{escape(category['name'])}</h3>
          </div>
          <button type="button" class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition-colors" data-modal-close><i class="ph-bold ph-x"></i></button>
        </div>
        
        <form class="flex flex-col gap-4" method="post" action="/projects/{project_id}/instances" data-component-prefill-form>
          <input type="hidden" name="category_id" value="{category['id']}">
          <input type="hidden" name="attribute_values_json" value="[]" data-instance-attributes-json>
          
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-bold text-zinc-400 uppercase tracking-widest">Template Component</label>
            <select name="component_id" required data-component-select class="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-sm text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono">
              {component_options}
            </select>
          </div>
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="flex flex-col gap-1.5">
                <label class="text-xs font-bold text-zinc-400 uppercase tracking-widest">Instance Name</label>
                <input name="name" required data-prefill-target="name" class="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-sm text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono">
              </div>
              <div class="flex flex-col gap-1.5">
                <label class="text-xs font-bold text-zinc-400 uppercase tracking-widest">Short Name (SKU)</label>
                <input name="short_name" data-prefill-target="short_name" class="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-sm text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono">
              </div>
          </div>
          
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-bold text-zinc-400 uppercase tracking-widest">Unit Amount</label>
            <input name="unit_amount" placeholder="Optional quantity basis" class="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-sm text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono">
          </div>
          
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-bold text-zinc-400 uppercase tracking-widest">Description</label>
            <textarea name="description" rows="3" data-prefill-target="description" class="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-sm text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"></textarea>
          </div>
          
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-bold text-zinc-400 uppercase tracking-widest">Installation</label>
            <textarea name="installation" rows="3" data-prefill-target="installation" class="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-sm text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"></textarea>
          </div>

          <div class="flex flex-col gap-2">
            <div class="text-xs font-bold text-zinc-400 uppercase tracking-widest">Attributes</div>
            <div class="bg-black/20 border border-white/10 rounded-lg p-3 flex flex-col gap-3" data-instance-attributes-editor></div>
          </div>
          
          <div class="sticky bottom-0 -mx-6 mt-4 px-6 py-4 bg-zinc-900/95 backdrop-blur border-t border-white/10 flex items-center justify-end gap-3">
            <button type="button" class="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg text-sm font-semibold transition-colors" data-modal-close>Cancel</button>
            <button class="px-4 py-2 bg-accent-500 hover:bg-accent-400 text-zinc-950 rounded-lg text-sm font-bold shadow-[0_0_15px_rgba(245,158,11,0.2)] transition-colors" type="submit">Create Instance</button>
          </div>
        </form>
      </div>
    </div>
    """


def _render_edit_instance_modal(project_id: int, category_id: int, instance: dict) -> str:
    attribute_fields = _render_instance_attribute_fields(instance["editable_attributes"])
    return f"""
    <div class="fixed inset-0 hidden items-center justify-center p-4 z-[100] modal-shell" data-modal="edit-instance-{instance['id']}" aria-hidden="true">
      <div class="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm modal-backdrop" data-modal-close></div>
      <div class="relative modal-card">
        
        <div class="flex items-start justify-between border-b border-white/10 pb-4 mb-6">
          <div>
            <p class="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1 flex items-center gap-2"><i class="ph-bold ph-pencil-simple"></i> Edit Project Instance</p>
            <h3 class="text-xl font-bold text-white">{escape(instance['name'])}</h3>
          </div>
          <button type="button" class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition-colors" data-modal-close><i class="ph-bold ph-x"></i></button>
        </div>
        
        <form class="flex flex-col gap-4" method="post" action="/projects/{project_id}/instances/{instance['id']}/update" data-instance-attribute-form>
          <input type="hidden" name="category_id" value="{category_id}">
          <input type="hidden" name="attribute_values_json" value="[]" data-instance-attributes-json>
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="flex flex-col gap-1.5">
                <label class="text-xs font-bold text-zinc-400 uppercase tracking-widest">Instance Name</label>
                <input name="name" value="{escape(instance['name'])}" required class="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-sm text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono">
              </div>
              <div class="flex flex-col gap-1.5">
                <label class="text-xs font-bold text-zinc-400 uppercase tracking-widest">Short Name (SKU)</label>
                <input name="short_name" value="{escape(instance['short_name'] or '')}" class="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-sm text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono">
              </div>
          </div>
          
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-bold text-zinc-400 uppercase tracking-widest">Unit Amount</label>
            <input name="unit_amount" value="{escape(str(instance['unit_amount']) if instance['unit_amount'] is not None else '')}" class="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-sm text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono">
          </div>
          
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-bold text-zinc-400 uppercase tracking-widest">Description</label>
            <textarea name="description" rows="4" class="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-sm text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono">{escape(instance['description'] or '')}</textarea>
          </div>
          
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-bold text-zinc-400 uppercase tracking-widest">Installation</label>
            <textarea name="installation" rows="4" class="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-sm text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono">{escape(instance['installation'] or '')}</textarea>
          </div>

          <div class="flex flex-col gap-2">
            <div class="text-xs font-bold text-zinc-400 uppercase tracking-widest">Attributes</div>
            <div class="bg-black/20 border border-white/10 rounded-lg p-3 flex flex-col gap-3">
              {attribute_fields}
            </div>
          </div>
          
          <div class="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mt-2 flex gap-3">
            <i class="ph-fill ph-warning-circle text-amber-500 text-lg"></i>
            <p class="text-xs text-amber-200 font-mono">Saving marks this snapshot as customized. Use refresh if you want to pull catalog data forward instead.</p>
          </div>
          
          <div class="sticky bottom-0 -mx-6 mt-2 px-6 py-4 bg-zinc-900/95 backdrop-blur border-t border-white/10 flex items-center justify-end gap-3">
            <button type="button" class="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg text-sm font-semibold transition-colors" data-modal-close>Cancel</button>
            <button class="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm font-bold transition-colors" type="submit">Save Instance</button>
          </div>
        </form>
      </div>
    </div>
    """


def _render_instance_attribute_fields(attributes: list[dict]) -> str:
    if not attributes:
        return "<p class='text-xs text-zinc-500 font-mono italic'>This component has no catalog attributes.</p>"

    rows = []
    for attribute in attributes:
        field_name = escape(attribute["name"])
        input_name = escape(attribute["name"], quote=True)
        current_value = attribute.get("value")
        if attribute["value_type"] == "select":
            options = "".join(
                f'<option value="{escape(option, quote=True)}" {"selected" if option == current_value else ""}>{escape(option)}</option>'
                for option in attribute["options"]
            )
            control = f"""
            <select
              data-instance-attribute-input
              data-attribute-name="{input_name}"
              class="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-sm text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
            >
              <option value="">Select value</option>
              {options}
            </select>
            """
        else:
            input_type = "number" if attribute["value_type"] == "number" else "text"
            control = f"""
            <input
              type="{input_type}"
              value="{escape(str(current_value) if current_value is not None else '', quote=True)}"
              data-instance-attribute-input
              data-attribute-name="{input_name}"
              class="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-sm text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
              placeholder="Enter value"
            >
            """
        rows.append(
            f"""
            <div class="flex flex-col gap-1.5">
              <label class="text-xs font-bold text-zinc-400 uppercase tracking-widest">{field_name}</label>
              {control}
            </div>
            """
        )
    return "".join(rows)


def _render_bom_material(material: dict) -> str:
    bom_rows = "".join(
        f"""
        <tr class="group hover:bg-white/5 transition-colors {_quantity_class(row['quantity'])}">
          <td class="px-3 py-2 text-zinc-300 font-medium text-sm w-1/4">{escape(row['subtype'])}</td>
          <td class="px-3 py-2 text-right font-mono text-sm w-1/6">{_format_quantity(row['quantity'])}</td>
          <td class="px-3 py-2 text-right font-mono text-sm text-zinc-500 w-1/6">{_format_quantity(row['assembly_quantity'])}</td>
          <td class="px-3 py-2 text-zinc-400 font-mono text-xs w-1/6">{escape(row['unit'] or '-')}</td>
          <td class="px-3 py-2 text-zinc-500 font-mono text-[10px] uppercase w-1/12">{escape(row['calculation_mode'])}</td>
          <td class="px-3 py-2 text-zinc-500 font-mono text-xs truncate max-w-[100px]" title="{escape(row['calculation_formula'] or '-')}">{escape(row['calculation_formula'] or '-')}</td>
        </tr>
        """
        for row in material["bom_entries"]
    ) or "<tr><td colspan='6' class='px-3 py-4 text-center text-zinc-500 font-mono text-xs'>Applicable, but no BOM row stored yet.</td></tr>"
    
    return f"""
    <div class="bg-black/20 border border-white/5 rounded-lg overflow-hidden">
      <!-- Material Header -->
      <div class="flex items-center justify-between p-3 border-b border-white/5 bg-black/40">
        <div class="flex items-center gap-3">
          <h5 class="font-bold text-sm text-white flex items-center gap-2">{escape(material['material_name'])}</h5>
          <span class="px-2 py-0.5 bg-black/40 border border-white/5 rounded text-[10px] font-mono text-zinc-400">{escape(material['sku'])}</span>
        </div>
        <div class="text-right flex flex-col items-end">
            <span class="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Rule Qty</span>
            <span class="text-xs font-mono text-accent-400">{escape(str(material['unit_qty_per_unit']) if material['unit_qty_per_unit'] is not None else '-')} {escape(material['unit'] or '-')}</span>
        </div>
      </div>
      
      {f'<div class="px-3 py-2 border-b border-white/5 text-xs text-zinc-400 bg-black/20">{escape(material["notes"])}</div>' if material['notes'] else ''}
      
      <!-- BOM Table -->
      <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-sm">
            <thead class="bg-black/40 border-b border-white/5">
              <tr>
                <th class="px-3 py-1.5 text-[10px] text-zinc-500 font-bold uppercase tracking-widest w-1/4">Subtype</th>
                <th class="px-3 py-1.5 text-[10px] text-zinc-500 font-bold uppercase tracking-widest text-right w-1/6">Quantity</th>
                <th class="px-3 py-1.5 text-[10px] text-zinc-500 font-bold uppercase tracking-widest text-right w-1/6">Assembly Kit</th>
                <th class="px-3 py-1.5 text-[10px] text-zinc-500 font-bold uppercase tracking-widest w-1/6">Unit</th>
                <th class="px-3 py-1.5 text-[10px] text-zinc-500 font-bold uppercase tracking-widest w-1/12">Source</th>
                <th class="px-3 py-1.5 text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Formula</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-white/5">
              {bom_rows}
            </tbody>
          </table>
      </div>
    </div>
    """


def _render_subtype(subtype: dict) -> str:
    children = "".join(_render_subtype(child) for child in subtype["children"])
    child_block = f"<ul class='ml-2 border-l border-white/10 pl-3 mt-1 space-y-1'>{children}</ul>" if children else ""
    return f"<li class='py-0.5 relative before:absolute before:w-2 before:h-px before:-left-3 before:top-2.5 before:bg-white/10'>{escape(subtype['name'])}{child_block}</li>"


def _nav_link(href: str, label: str, active: bool) -> str:
    icon = "ph-rocket"
    if label == "Database Editor":
        icon = "ph-database"
    elif label == "Projects":
        icon = "ph-kanban"
    
    if active:
        return f'''
        <a href="{href}" class="w-full aspect-square rounded-xl bg-white/10 text-white flex items-center justify-center border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-transform active:scale-95 group relative">
            <i class="ph-fill {icon} text-xl"></i>
            <div class="absolute left-full ml-4 px-2 py-1 bg-zinc-800 text-xs rounded border border-white/10 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">{escape(label)}</div>
        </a>'''
    else:
        return f'''
        <a href="{href}" class="w-full aspect-square rounded-xl text-zinc-500 hover:text-zinc-200 hover:bg-white/5 flex items-center justify-center transition-all group relative">
            <i class="ph-bold {icon} text-xl"></i>
            <div class="absolute left-full ml-4 px-2 py-1 bg-zinc-800 text-xs rounded border border-white/10 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">{escape(label)}</div>
        </a>'''


def _format_condition(clause: dict) -> str:
    right_side = clause["comparison_value"] or ""
    if clause["comparison_value_secondary"]:
        right_side = f"{right_side} and {clause['comparison_value_secondary']}"
    return f"{clause['attribute_name']} {clause['operator']} {right_side}".strip()


def _quantity_class(value: float | None) -> str:
    if value is None:
        return "text-zinc-500"
    if value == 0:
        return "opacity-50"
    return "text-accent-400 font-bold"


def _format_quantity(value: float | None) -> str:
    if value is None:
        return ""
    if float(value).is_integer():
        return str(int(value))
    return f"{value:.2f}"
