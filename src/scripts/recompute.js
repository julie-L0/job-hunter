import { recomputeApplyRecords } from "../services/resume.js";

const result = await recomputeApplyRecords();
console.log(`简历库投递记录已更新 ${result.updated} 条`);
