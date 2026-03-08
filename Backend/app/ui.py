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
    for status in ordered_statuses:
        cards = "".join(
            f"""
            <article class="project-card">
              <div>
                <p class="project-name">{escape(project['name'])}</p>
                <p class="subtle">{escape(project['description'] or 'No description.')}</p>
              </div>
              <div class="project-meta">
                <span>{project['instance_count']} instances</span>
                <span>Updated {escape(project['updated_at'])}</span>
              </div>
              <a class="button-link secondary" href="/projects/{project['id']}">Open project</a>
            </article>
            """
            for project in data["grouped_projects"][status]
        ) or "<p class='empty-state'>No projects in this status.</p>"
        columns.append(
            f"""
            <section class="panel status-column">
              <div class="panel-header compact">
                <div>
                  <p class="card-kicker">Lifecycle</p>
                  <h2>{escape(data['status_labels'][status])}</h2>
                </div>
                <span class="badge">{len(data['grouped_projects'][status])}</span>
              </div>
              <div class="stacked-list">{cards}</div>
            </section>
            """
        )

    content = f"""
    <section class="inline-grid three-col">
      <form class="panel form-panel" method="post" action="/projects">
        <h2>Create project</h2>
        <label>Name<input name="name" required></label>
        <label>Status
          <select name="status">
            <option value="template">Project Template</option>
            <option value="execution">Execution Project</option>
            <option value="finished">Finished Project</option>
          </select>
        </label>
        <label>Description<textarea name="description" rows="4"></textarea></label>
        <button class="button-link" type="submit">Create project</button>
      </form>
      <article class="panel info-card span-two">
        <p class="card-kicker">Project board</p>
        <h2>Project lifecycle preserved</h2>
        <p>The legacy statuses remain explicit domain states. The viewer workspace keeps templates, execution projects, and finished work together in one model while still allowing status-based browsing.</p>
      </article>
    </section>
    <section class="inline-grid three-col status-grid">
      {''.join(columns)}
    </section>
    """
    return render_layout(title="Projects", active_nav="projects", content=content)


def render_project_detail_page(data: dict) -> str:
    project = data["project"]
    sections = []
    category_links = []
    for category in data["categories"]:
        category_links.append(
            f'<a href="#category-{category["id"]}" class="sidebar-link" data-category-link>{("&nbsp;" * category["depth"] * 2)}{escape(category["name"])}</a>'
        )
        component_options = "".join(
            f'<option value="{component["id"]}" data-name="{escape(component["name"])}" data-short-name="{escape(component["short_name"] or "")}" data-description="{escape(component["description"] or "")}" data-installation="{escape(component["installation"] or "")}">{escape(component["name"])} ({escape(component["type"])})</option>'
            for component in category["available_components"]
        )
        create_instance_modal = _render_create_instance_modal(project["id"], category, component_options) if category["available_components"] else ""
        create_instance_action = (
            f'<button type="button" class="button-link secondary" data-modal-open="add-instance-{category["id"]}">Add instance</button>'
            if category["available_components"]
            else "<p class='subtle'>No reusable components exist in this category yet.</p>"
        )
        instance_cards = "".join(
            _render_project_instance(project["id"], category["id"], instance)
            for instance in category["instances"]
        ) or "<p class='empty-state'>No project instances in this category yet.</p>"
        linked_categories = "".join(
            f'<span class="badge">{escape(name)}</span>' for name in category["linked_categories"]
        ) or "<span class='subtle'>No linked accessory targets.</span>"
        sections.append(
            f"""
            <section id="category-{category['id']}" class="panel category-section depth-{category['depth']}">
              <div class="panel-header compact">
                <div>
                  <p class="card-kicker">Category</p>
                  <h2>{escape(category['name'])}</h2>
                </div>
                <span class="badge badge-scope">{escape(category['scope'])}</span>
              </div>
              <div class="linked-row">
                <strong>Linked accessory categories:</strong> {linked_categories}
              </div>
              <div class="category-actions">
                {create_instance_action}
              </div>
              {create_instance_modal}
              <div class="stacked-list">{instance_cards}</div>
            </section>
            """
        )

    subtype_tree = "".join(_render_subtype(subtype) for subtype in data["subtypes"]) or "<li>No subtype breakdown defined.</li>"
    auxiliary_rows = "".join(
        f"""
        <tr>
          <td>{escape(row['code'])}</td>
          <td>{escape(row['name'])}</td>
          <td>{escape(row['category'] or 'Uncategorized')}</td>
          <td>{escape(row['subtype'])}</td>
          <td>{row['price']:,.0f}</td>
        </tr>
        """
        for row in data["auxiliary_materials"]
    ) or "<tr><td colspan='5'>No auxiliary materials selected.</td></tr>"

    content = f"""
    <section class="project-hero panel">
      <div>
        <p class="card-kicker">Project viewer</p>
        <h2>{escape(project['name'])}</h2>
        <p>{escape(project['description'] or 'No description.')}</p>
      </div>
      <div class="hero-meta">
        <span class="badge">{escape(project['status_label'])}</span>
        <span>{project['instance_count']} project instances</span>
      </div>
    </section>
    <section class="workspace project-workspace">
      <aside class="sidebar panel">
        <div class="sidebar-head">
          <p class="card-kicker">Jump to category</p>
          <input id="projectCategorySearch" type="search" placeholder="Filter categories">
        </div>
        <div class="sidebar-links" data-tree-filter-target>
          {''.join(category_links)}
        </div>
        <div class="subtypes-block">
          <h3>Subtype tree</h3>
          <ul class="tree-list">{subtype_tree}</ul>
        </div>
      </aside>
      <section class="workspace-main">
        {''.join(sections)}
        <section class="panel">
          <div class="panel-header compact">
            <div>
              <p class="card-kicker">Auxiliary materials</p>
              <h2>Project-level selections</h2>
            </div>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Category</th>
                <th>Subtype</th>
                <th>Base price</th>
              </tr>
            </thead>
            <tbody>{auxiliary_rows}</tbody>
          </table>
        </section>
      </section>
    </section>
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
                <!-- Attributes Section -->
                <div>
                    <h6 class="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2"><i class="ph-bold ph-list-dashes text-zinc-600"></i> Attributes</h6>
                    {attribute_editor}
                </div>

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
            >Save attribute set</button>
        </div>
        <p class="text-[10px] text-zinc-500 font-mono">Legacy-style editor: build attributes as rows and add individual option values inside each select attribute.</p>
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
        <article class="attribute-group">
          <h5>{escape(group['name'])}</h5>
          <p class="subtle">{escape(group['application_label'] or 'Base attributes')}</p>
          <dl class="attribute-grid">
            {''.join(f'<div><dt>{escape(row["name"])}</dt><dd>{escape(row["value"] or "-")}</dd></div>' for row in group['values'])}
          </dl>
        </article>
        """
        for group in instance["attributes"]
    ) or "<p class='empty-state'>No attributes loaded.</p>"

    linked_accessories = "".join(
        _render_instance_link_badge(link) for link in instance["linked_accessories"]
    ) or "<span class='subtle'>None</span>"
    linked_to = "".join(
        _render_instance_link_badge(link) for link in instance["linked_to"]
    ) or "<span class='subtle'>Standalone</span>"
    material_rows = "".join(_render_bom_material(material) for material in instance["materials"]) or "<p class='empty-state'>No applicable materials resolved for this instance.</p>"
    edit_modal = _render_edit_instance_modal(project_id, category_id, instance)

    return f"""
    <article class="instance-card">
      <div class="panel-header compact">
        <div>
          <p class="card-kicker">{escape(instance['type'])}</p>
          <h3>{escape(instance['name'])}</h3>
        </div>
        <div class="instance-card-actions">
          <span class="badge">{escape(instance['short_name'] or instance['name'])}</span>
          <button type="button" class="button-link secondary" data-modal-open="edit-instance-{instance['id']}">Edit</button>
          <form method="post" action="/projects/{project_id}/instances/{instance['id']}/delete" onsubmit="return confirm('Delete this project instance and its project-scoped records?');">
            <input type="hidden" name="category_id" value="{category_id}">
            <button class="button-link danger" type="submit">Delete</button>
          </form>
        </div>
      </div>
      <p>{escape(instance['description'] or 'No description yet.')}</p>
      <p class="subtle">Unit amount: {escape(str(instance['unit_amount']) if instance['unit_amount'] is not None else '-')}</p>
      <p class="subtle">Sync state: {escape(instance['sync_state']['status'])}</p>
      <div class="inline-grid two-col">
        <div>
          <h4>Attributes</h4>
          {attribute_blocks}
        </div>
        <div>
          <h4>Relationships</h4>
          <p><strong>Linked accessories:</strong> {linked_accessories}</p>
          <p><strong>Attached to:</strong> {linked_to}</p>
          <h4>Installation</h4>
          <p>{escape(instance['installation'] or 'No installation notes.')}</p>
        </div>
      </div>
      <div class="materials-table">
        <h4>Applicable materials</h4>
        {material_rows}
      </div>
    </article>
    {edit_modal}
    """


def _render_instance_link_badge(link: dict) -> str:
    label = escape(link["name"])
    if link.get("application_label"):
        label = f"{label} · {escape(link['application_label'])}"
    return f'<span class="badge">{label}</span>'


def _render_create_instance_modal(project_id: int, category: dict, component_options: str) -> str:
    return f"""
    <div class="modal-shell" data-modal="add-instance-{category['id']}" aria-hidden="true">
      <div class="modal-backdrop" data-modal-close></div>
      <section class="modal-card">
        <div class="panel-header compact">
          <div>
            <p class="card-kicker">Create project instance</p>
            <h3>{escape(category['name'])}</h3>
          </div>
          <button type="button" class="button-link secondary" data-modal-close>Close</button>
        </div>
        <form class="form-panel compact-form" method="post" action="/projects/{project_id}/instances" data-component-prefill-form>
          <input type="hidden" name="category_id" value="{category['id']}">
          <label>Template component
            <select name="component_id" required data-component-select>
              {component_options}
            </select>
          </label>
          <label>Instance name<input name="name" required data-prefill-target="name"></label>
          <label>Short name<input name="short_name" data-prefill-target="short_name"></label>
          <label>Unit amount<input name="unit_amount" placeholder="Optional quantity basis"></label>
          <label>Description<textarea name="description" rows="3" data-prefill-target="description"></textarea></label>
          <label>Installation<textarea name="installation" rows="3" data-prefill-target="installation"></textarea></label>
          <div class="modal-actions">
            <button type="button" class="button-link secondary" data-modal-close>Cancel</button>
            <button class="button-link" type="submit">Create instance</button>
          </div>
        </form>
      </section>
    </div>
    """


def _render_edit_instance_modal(project_id: int, category_id: int, instance: dict) -> str:
    return f"""
    <div class="modal-shell" data-modal="edit-instance-{instance['id']}" aria-hidden="true">
      <div class="modal-backdrop" data-modal-close></div>
      <section class="modal-card">
        <div class="panel-header compact">
          <div>
            <p class="card-kicker">Edit project instance</p>
            <h3>{escape(instance['name'])}</h3>
          </div>
          <button type="button" class="button-link secondary" data-modal-close>Close</button>
        </div>
        <form class="form-panel compact-form" method="post" action="/projects/{project_id}/instances/{instance['id']}/update">
          <input type="hidden" name="category_id" value="{category_id}">
          <label>Name<input name="name" value="{escape(instance['name'])}" required></label>
          <label>Short name<input name="short_name" value="{escape(instance['short_name'] or '')}"></label>
          <label>Unit amount<input name="unit_amount" value="{escape(str(instance['unit_amount']) if instance['unit_amount'] is not None else '')}"></label>
          <label>Description<textarea name="description" rows="4">{escape(instance['description'] or '')}</textarea></label>
          <label>Installation<textarea name="installation" rows="4">{escape(instance['installation'] or '')}</textarea></label>
          <p class="subtle">Saving marks this snapshot as customized. Use refresh if you want to pull catalog data forward instead.</p>
          <div class="modal-actions">
            <button type="button" class="button-link secondary" data-modal-close>Cancel</button>
            <button class="button-link" type="submit">Save instance</button>
          </div>
        </form>
      </section>
    </div>
    """


def _render_bom_material(material: dict) -> str:
    bom_rows = "".join(
        f"""
        <tr class="{_quantity_class(row['quantity'])}">
          <td>{escape(row['subtype'])}</td>
          <td>{_format_quantity(row['quantity'])}</td>
          <td>{_format_quantity(row['assembly_quantity'])}</td>
          <td>{escape(row['unit'] or '-')}</td>
          <td>{escape(row['calculation_mode'])}</td>
          <td>{escape(row['calculation_formula'] or '-')}</td>
        </tr>
        """
        for row in material["bom_entries"]
    ) or "<tr><td colspan='6'>Applicable, but no BOM row stored yet.</td></tr>"
    return f"""
    <article class="material-card">
      <div class="material-rule-head">
        <strong>{escape(material['material_name'])}</strong>
        <span>{escape(material['sku'])}</span>
      </div>
      <p class="subtle">Rule qty per unit: {escape(str(material['unit_qty_per_unit']) if material['unit_qty_per_unit'] is not None else '-')} {escape(material['unit'] or '-')}</p>
      <p>{escape(material['notes'] or 'No notes.')}</p>
      <table class="data-table compact">
        <thead>
          <tr>
            <th>Subtype</th>
            <th>Quantity</th>
            <th>Assembly kit</th>
            <th>Unit</th>
            <th>Source</th>
            <th>Formula</th>
          </tr>
        </thead>
        <tbody>{bom_rows}</tbody>
      </table>
      <p class="legend-note">Blank quantity means applicable but not quantified yet. Zero means intentionally suppressed.</p>
    </article>
    """


def _render_subtype(subtype: dict) -> str:
    children = "".join(_render_subtype(child) for child in subtype["children"])
    child_block = f"<ul>{children}</ul>" if children else ""
    return f"<li>{escape(subtype['name'])}{child_block}</li>"


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
        return "qty-blank"
    if value == 0:
        return "qty-zero"
    return "qty-normal"


def _format_quantity(value: float | None) -> str:
    if value is None:
        return ""
    if float(value).is_integer():
        return str(int(value))
    return f"{value:.2f}"
