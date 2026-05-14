import addOnSandboxSdk from "add-on-sdk-document-sandbox";
import { editor } from "express-document-sdk";

function firstRenditionTarget(selection) {
    for (const node of selection) {
        if (node && typeof node.createRendition === "function") {
            return node;
        }
    }
    return null;
}

addOnSandboxSdk.instance.runtime.exposeApi({
    /**
     * Rasterize the first selected visual node (including its subtree) as PNG for use as a custom mask.
     * @returns {{ ok: true, blob: Blob } | { ok: false, code: string, message?: string }}
     */
    async getSelectionMaskPng() {
        const selection = editor.context.selection;
        const target = firstRenditionTarget(selection);
        if (!target) {
            if (!editor.context.hasSelection) {
                return { ok: false, code: "noSelection" };
            }
            return { ok: false, code: "noRenditionTarget" };
        }
        try {
            const result = await target.createRendition({ format: "png" });
            if (!result?.blob) {
                return { ok: false, code: "noBlob" };
            }
            return { ok: true, blob: result.blob };
        } catch (err) {
            return {
                ok: false,
                code: "renditionError",
                message: err && typeof err.message === "string" ? err.message : String(err),
            };
        }
    },
});
