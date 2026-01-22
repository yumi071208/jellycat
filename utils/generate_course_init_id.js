/**
 * 生成唯一的课程/订单初始化ID
 */
function generateCourseInitId(prefix = 'ORDER') {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    const uniqueId = `${prefix}_${timestamp}_${random}`;
    
    return {
        id: uniqueId,
        timestamp: timestamp,
        formatted: uniqueId
    };
}

/**
 * 生成 NETS 兼容的交易参考号
 */
function generateNETSReference() {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    const timestamp = `${year}${month}${day}${hours}${minutes}${seconds}`;
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    
    return `NETS${timestamp}${random}`;
}

module.exports = {
    generateCourseInitId,
    generateNETSReference
};