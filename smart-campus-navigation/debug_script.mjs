import { chromium } from "playwright";

(async () => {
    try {
        console.log("Launching browser...");
        const browser = await chromium.launch();
        const page = await browser.newPage();
        
        let errorCaught = false;

        page.on("pageerror", (err) => {
            console.error("PAGE ERROR CAUGHT:", err.message, err.stack);
            errorCaught = true;
        });

        page.on("console", (msg) => {
            if (msg.type() === "error") {
                console.error("CONSOLE ERROR CAUGHT:", msg.text());
                errorCaught = true;
            }
        });

        console.log("Navigating to http://localhost:5174...");
        await page.goto("http://localhost:5174");
        await page.waitForTimeout(2000);

        console.log("Clicking CLASSROOM AVAILABILITY tab...");
        // Use a generic selector for the tab text
        await page.locator("text=ROOM AVAILABILITY").click();

        await page.waitForTimeout(2000);

        console.log("Clicking INDOOR NAVIGATION tab...");
        await page.locator("text=INDOOR NAVIGATION").click();
        
        await page.waitForTimeout(2000);

        console.log("Done checking tabs. Error status:", errorCaught);
        await browser.close();
    } catch (e) {
        console.error("Script failed:", e);
    }
})();
