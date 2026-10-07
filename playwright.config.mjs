import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests/browser',workers:1,timeout:45000,outputDir:'qa-results/playwright',reporter:'list',use:{browserName:'chromium',headless:true,viewport:{width:390,height:844},screenshot:'only-on-failure'}});
