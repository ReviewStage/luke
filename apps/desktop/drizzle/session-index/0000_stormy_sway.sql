CREATE TABLE `observed_sessions` (
	`provider_id` text NOT NULL,
	`provider_session_id` text NOT NULL,
	`title` text NOT NULL,
	`branch` text,
	`recap` text,
	`status` text NOT NULL,
	`observed_at` integer NOT NULL,
	`provider_label` text NOT NULL,
	`location` text NOT NULL,
	`repository_label` text,
	`workspace_label` text,
	`standing` integer NOT NULL,
	`holding_for_developer` integer NOT NULL,
	`about_hash` text NOT NULL,
	PRIMARY KEY(`provider_id`, `provider_session_id`)
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `observed_sessions_fts` USING fts5(
	`title`,
	`branch`,
	`recap`,
	`provider_label`,
	`repository_label`,
	`workspace_label`,
	content=`observed_sessions`,
	content_rowid=`rowid`
);
--> statement-breakpoint
CREATE TRIGGER `observed_sessions_fts_insert` AFTER INSERT ON `observed_sessions` BEGIN
	INSERT INTO `observed_sessions_fts`(
		rowid,
		title,
		branch,
		recap,
		provider_label,
		repository_label,
		workspace_label
	) VALUES (
		new.rowid,
		new.title,
		new.branch,
		new.recap,
		new.provider_label,
		new.repository_label,
		new.workspace_label
	);
END;
--> statement-breakpoint
CREATE TRIGGER `observed_sessions_fts_delete` AFTER DELETE ON `observed_sessions` BEGIN
	INSERT INTO `observed_sessions_fts`(
		`observed_sessions_fts`,
		rowid,
		title,
		branch,
		recap,
		provider_label,
		repository_label,
		workspace_label
	) VALUES (
		'delete',
		old.rowid,
		old.title,
		old.branch,
		old.recap,
		old.provider_label,
		old.repository_label,
		old.workspace_label
	);
END;
--> statement-breakpoint
CREATE TRIGGER `observed_sessions_fts_update` AFTER UPDATE ON `observed_sessions` BEGIN
	INSERT INTO `observed_sessions_fts`(
		`observed_sessions_fts`,
		rowid,
		title,
		branch,
		recap,
		provider_label,
		repository_label,
		workspace_label
	) VALUES (
		'delete',
		old.rowid,
		old.title,
		old.branch,
		old.recap,
		old.provider_label,
		old.repository_label,
		old.workspace_label
	);
	INSERT INTO `observed_sessions_fts`(
		rowid,
		title,
		branch,
		recap,
		provider_label,
		repository_label,
		workspace_label
	) VALUES (
		new.rowid,
		new.title,
		new.branch,
		new.recap,
		new.provider_label,
		new.repository_label,
		new.workspace_label
	);
END;
