import { app } from "../domain-app";

export const Avatars = app.objectStore("avatars", {
	enabled: app.installation.spec.features.media,
	maxObjectBytes: 5_000_000,
	contentTypes: ["image/jpeg", "image/png", "image/webp"],
	mode: "immutable",
	browser: {
		upload: "signed",
		download: { mode: "signed", access: "authenticated" },
		ttlSeconds: 600,
	},
	deletion: "explicit",
});

export const Attachments = app.objectStore("attachments", {
	enabled: app.installation.spec.features.media,
	maxObjectBytes: 25_000_000,
	contentTypes: [
		"image/jpeg",
		"image/png",
		"image/webp",
		"image/gif",
		"video/mp4",
	],
	mode: "immutable",
	browser: {
		upload: "signed",
		download: { mode: "signed", access: "authenticated" },
		ttlSeconds: 600,
	},
	deletion: "explicit",
});
