-- this is the database that we use to store project specific information, going from the projects themselves down to their details such as which instances they have
CREATE TABLE Projects (
    project_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL UNIQUE,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    modified_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    estado VARCHAR()
);

CREATE TRIGGER update_projects_modified_date
AFTER UPDATE ON Projects
FOR EACH ROW
BEGIN
    UPDATE Projects SET modified_date = CURRENT_TIMESTAMP WHERE project_id = OLD.project_id;
END;

-- Table for project subtypes, allowing for nested structures (e.g., house types within a project)
CREATE TABLE Project_Subtypes (
    subtype_id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    parent_subtype_id INTEGER, -- NULL for top-level subtypes, references another subtype_id for nesting
    name VARCHAR(100) NOT NULL,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    modified_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES Projects(project_id) ON DELETE CASCADE,
    FOREIGN KEY (parent_subtype_id) REFERENCES Project_Subtypes(subtype_id) ON DELETE CASCADE
);

CREATE TRIGGER update_project_subtypes_modified_date
AFTER UPDATE ON Project_Subtypes
FOR EACH ROW
BEGIN
    UPDATE Project_Subtypes SET modified_date = CURRENT_TIMESTAMP WHERE subtype_id = OLD.subtype_id;
END;

CREATE INDEX idx_project_subtypes_project_id ON Project_Subtypes(project_id);
CREATE INDEX idx_project_subtypes_parent_id ON Project_Subtypes(parent_subtype_id);

CREATE TABLE Item_Instances (
    instance_id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,  -- References main.db Items.item_id
    name VARCHAR(50) NOT NULL,
    short_name VARCHAR(50),
    description TEXT,
    short_description TEXT,
    installation TEXT,
    hidden TEXT DEFAULT '[]',
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    modified_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES Projects(project_id) ON DELETE CASCADE
);

CREATE TRIGGER update_item_instances_modified_date
AFTER UPDATE ON Item_Instances
FOR EACH ROW
BEGIN
    UPDATE Item_Instances SET modified_date = CURRENT_TIMESTAMP WHERE instance_id = OLD.instance_id;
END;

-- Item Instance Attributes Table (snapshot of original item attributes)
CREATE TABLE Item_Instance_Attributes (
    attribute_id INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id INTEGER NOT NULL,
    name VARCHAR(50) NOT NULL,
    value TEXT DEFAULT '[]',
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    modified_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (instance_id) REFERENCES Item_Instances(instance_id) ON DELETE CASCADE
);

CREATE TRIGGER update_item_instance_attributes_modified_date
AFTER UPDATE ON Item_Instance_Attributes
FOR EACH ROW
BEGIN
    UPDATE Item_Instance_Attributes SET modified_date = CURRENT_TIMESTAMP WHERE attribute_id = OLD.attribute_id;
END;

-- Accessory Instance Table
CREATE TABLE Accessory_Instance (
    accessory_instance_id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    accessory_id INTEGER NOT NULL,  -- References main.db Accessory_Item.accessory_id
    name VARCHAR(50) NOT NULL,
    short_name VARCHAR(50),
    description TEXT,
    short_description TEXT,
    installation TEXT,
    hidden TEXT DEFAULT '[]',
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    modified_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES Projects(project_id) ON DELETE CASCADE
);

CREATE TRIGGER update_accessory_instance_modified_date
AFTER UPDATE ON Accessory_Instance
FOR EACH ROW
BEGIN
    UPDATE Accessory_Instance SET modified_date = CURRENT_TIMESTAMP WHERE accessory_instance_id = OLD.accessory_instance_id;
END;

-- Accessory Instance Attributes Table
CREATE TABLE Accessory_Instance_Attributes (
    attribute_id INTEGER PRIMARY KEY AUTOINCREMENT,
    accessory_instance_id INTEGER NOT NULL,
    application TEXT,
    name VARCHAR(50) NOT NULL,
    value TEXT DEFAULT '[]',
    group_id TEXT,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    modified_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (accessory_instance_id) REFERENCES Accessory_Instance(accessory_instance_id) ON DELETE CASCADE
);

 CREATE TABLE Bill_Of_Materials (
     bom_id INTEGER PRIMARY KEY AUTOINCREMENT,
     project_id INTEGER NOT NULL,
     subtype_id INTEGER, -- New column to link to Project_Subtypes
     material_id INTEGER NOT NULL,  -- References main.db Materials.material_id
     quantity REAL,
     assembly_kit REAL,
     unit VARCHAR(50),
     item_instance_id INTEGER,
     accessory_instance_id INTEGER,
     FOREIGN KEY (project_id) REFERENCES Projects(project_id) ON DELETE CASCADE,
     FOREIGN KEY (subtype_id) REFERENCES Project_Subtypes(subtype_id) ON DELETE CASCADE,
     FOREIGN KEY (item_instance_id) REFERENCES Item_Instances(instance_id) ON DELETE CASCADE,
     FOREIGN KEY (accessory_instance_id) REFERENCES Accessory_Instance(accessory_instance_id) ON DELETE CASCADE
     -- No Foreign Key constraint to main.db for material_id to avoid cross-database constraints
 );

 CREATE INDEX idx_bom_project_id ON Bill_Of_Materials(project_id);
 CREATE INDEX idx_bom_subtype_id ON Bill_Of_Materials(subtype_id);
 CREATE INDEX idx_bom_material_id ON Bill_Of_Materials(material_id);
 CREATE INDEX idx_bom_item_instance_id ON Bill_Of_Materials(item_instance_id);
 CREATE INDEX idx_bom_accessory_instance_id ON Bill_Of_Materials(accessory_instance_id);

-- Changelog Table to track modifications within projects
CREATE TABLE Changelog (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    project_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,     -- Assuming username is stored as text
    entity_type TEXT NOT NULL, -- e.g., 'Project', 'ItemInstance', 'AccessoryInstance', 'Attribute', 'MaterialQuantity'
    entity_id TEXT NOT NULL,   -- ID of the specific entity (can be INTEGER or TEXT depending on entity)
    action TEXT NOT NULL,      -- e.g., 'Create', 'Update', 'Delete', 'StatusChange'
    field_name TEXT,           -- Name of the field changed (e.g., 'name', 'quantity', 'status')
    old_value TEXT,            -- Value before the change
    new_value TEXT,            -- Value after the change
    details TEXT,              -- Optional additional context
    project_estado VARCHAR (50),
    approved_by TEXT,          -- User who approved the change (NULL if not approved)
    approved_date DATETIME,    -- Timestamp when the change was approved (NULL if not approved)
    FOREIGN KEY (project_id) REFERENCES Projects(project_id) ON DELETE CASCADE
);

-- Indexes for Changelog table for efficient querying
CREATE INDEX idx_changelog_project_id ON Changelog(project_id);
CREATE INDEX idx_changelog_timestamp ON Changelog(timestamp);
CREATE INDEX idx_changelog_user_id ON Changelog(user_id);
CREATE INDEX idx_changelog_entity ON Changelog(entity_type, entity_id);

CREATE TRIGGER update_accessory_instance_attributes_modified_date
AFTER UPDATE ON Accessory_Instance_Attributes
FOR EACH ROW
BEGIN
    UPDATE Accessory_Instance_Attributes SET modified_date = CURRENT_TIMESTAMP WHERE attribute_id = OLD.attribute_id;
END;

CREATE INDEX idx_item_instances ON Item_Instances(project_id);
CREATE INDEX idx_accessory_instances ON Accessory_Instance(project_id);
CREATE INDEX idx_item_instance_attrs ON Item_Instance_Attributes(instance_id);
CREATE INDEX idx_accessory_instance_attrs ON Accessory_Instance_Attributes(accessory_instance_id);
CREATE INDEX idx_accessory_group_id ON Accessory_Instance_Attributes(group_id);

CREATE TABLE Project_Material_Config (
    project_id INTEGER NOT NULL,
    material_id INTEGER NOT NULL,
    is_per_subtype BOOLEAN NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, material_id),
    FOREIGN KEY (project_id) REFERENCES Projects(project_id) ON DELETE CASCADE
);

CREATE INDEX idx_project_material_config ON Project_Material_Config(project_id, material_id);

-- Per-instance export settings for PDFs (e.g., Commercial)
-- Allows fine-grained control over what appears in a given project's PDF
CREATE TABLE IF NOT EXISTS Instance_Export_Settings (
    project_id INTEGER NOT NULL,
    instance_type TEXT NOT NULL, -- 'item' or 'accessory'
    instance_id INTEGER NOT NULL,
    target TEXT NOT NULL DEFAULT 'commercial',
    settings TEXT NOT NULL, -- JSON object
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    modified_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, instance_type, instance_id, target),
    FOREIGN KEY (project_id) REFERENCES Projects(project_id) ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS update_instance_export_settings_modified_date
AFTER UPDATE ON Instance_Export_Settings
FOR EACH ROW
BEGIN
    UPDATE Instance_Export_Settings SET modified_date = CURRENT_TIMESTAMP
    WHERE project_id = OLD.project_id AND instance_type = OLD.instance_type AND instance_id = OLD.instance_id AND target = OLD.target;
END;

CREATE INDEX IF NOT EXISTS idx_export_settings_project_target ON Instance_Export_Settings(project_id, target);

-- Project-level selection of auxiliary materials from main.db
CREATE TABLE IF NOT EXISTS Project_Auxiliary_Materials (
    project_auxiliary_id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    auxiliary_id INTEGER NOT NULL,
    subtype_id INTEGER,
    FOREIGN KEY (project_id) REFERENCES Projects(project_id) ON DELETE CASCADE,
    FOREIGN KEY (subtype_id) REFERENCES Project_Subtypes(subtype_id) ON DELETE CASCADE,
    UNIQUE (project_id, auxiliary_id)
);

CREATE INDEX IF NOT EXISTS idx_project_aux_materials_project ON Project_Auxiliary_Materials(project_id);
CREATE INDEX IF NOT EXISTS idx_project_aux_materials_aux ON Project_Auxiliary_Materials(auxiliary_id);
CREATE INDEX IF NOT EXISTS idx_project_aux_materials_subtype ON Project_Auxiliary_Materials(subtype_id);

-- Comment system tables
CREATE TABLE IF NOT EXISTS Instance_Comments (
    comment_id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    item_instance_id INTEGER,
    accessory_instance_id INTEGER,
    parent_comment_id INTEGER,
    author_username TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        (
            (item_instance_id IS NOT NULL AND accessory_instance_id IS NULL) OR
            (item_instance_id IS NULL AND accessory_instance_id IS NOT NULL)
        )
    ),
    FOREIGN KEY (project_id) REFERENCES Projects(project_id) ON DELETE CASCADE,
    FOREIGN KEY (item_instance_id) REFERENCES Item_Instances(instance_id) ON DELETE CASCADE,
    FOREIGN KEY (accessory_instance_id) REFERENCES Accessory_Instance(accessory_instance_id) ON DELETE CASCADE,
    FOREIGN KEY (parent_comment_id) REFERENCES Instance_Comments(comment_id) ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS update_instance_comments_updated_at
AFTER UPDATE ON Instance_Comments
FOR EACH ROW
BEGIN
    UPDATE Instance_Comments SET updated_at = CURRENT_TIMESTAMP WHERE comment_id = OLD.comment_id;
END;

CREATE INDEX IF NOT EXISTS idx_instance_comments_project ON Instance_Comments(project_id);
CREATE INDEX IF NOT EXISTS idx_instance_comments_item ON Instance_Comments(item_instance_id);
CREATE INDEX IF NOT EXISTS idx_instance_comments_accessory ON Instance_Comments(accessory_instance_id);
CREATE INDEX IF NOT EXISTS idx_instance_comments_parent ON Instance_Comments(parent_comment_id);

CREATE TABLE IF NOT EXISTS Comment_Mentions (
    mention_id INTEGER PRIMARY KEY AUTOINCREMENT,
    comment_id INTEGER NOT NULL,
    mentioned_username TEXT NOT NULL,
    FOREIGN KEY (comment_id) REFERENCES Instance_Comments(comment_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comment_mentions_comment ON Comment_Mentions(comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_mentions_username ON Comment_Mentions(mentioned_username);

CREATE TABLE IF NOT EXISTS Comment_Notifications (
    notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    comment_id INTEGER NOT NULL,
    notification_type TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CHECK (notification_type IN ('mention', 'reply')),
    FOREIGN KEY (comment_id) REFERENCES Instance_Comments(comment_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comment_notifications_user ON Comment_Notifications(username, is_read);
CREATE INDEX IF NOT EXISTS idx_comment_notifications_comment ON Comment_Notifications(comment_id);
