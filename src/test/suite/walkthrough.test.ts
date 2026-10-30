import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { REPOSITORY_ROOT, readPackageJson, type PackageJson } from "./packageFixtures";

function readSteps(): PackageJson["contributes"]["walkthroughs"][number]["steps"] {
	return readPackageJson().contributes.walkthroughs.flatMap((walkthrough) => walkthrough.steps);
}

suite("Walkthrough Test Suite", () => {
	test("walkthrough media and markdown exist", () => {
		const steps = readSteps();
		assert.ok(steps.length > 0, "The walkthrough should declare steps");

		for (const step of steps) {
			const mediaPath = step.media.markdown ?? step.media.image;
			assert.ok(mediaPath, `Step ${step.id} should declare a markdown or image media`);
			const mediaFile = path.join(REPOSITORY_ROOT, mediaPath);
			assert.ok(fs.existsSync(mediaFile), `Step ${step.id}: ${mediaPath} should exist`);

			if (!step.media.markdown) {
				continue;
			}
			const content = fs.readFileSync(mediaFile, "utf8");
			for (const match of content.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
				const target = match[1];
				if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
					continue;
				}
				const imageFile = path.resolve(path.dirname(mediaFile), target);
				assert.ok(fs.existsSync(imageFile), `Step ${step.id}: image ${target} should resolve from ${mediaPath}`);
			}
		}
	});
});
