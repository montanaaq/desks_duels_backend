// Функция для повторных попыток операции при ошибках блокировки базы данных
async function retryOperation(operation, maxRetries = 3) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            if (error.name === 'SequelizeTimeoutError' || error.parent?.code === 'SQLITE_BUSY') {
                await new Promise(resolve => setTimeout(resolve, 500 * (i + 1))); // Увеличивающаяся задержка
                continue;
            }
            throw error;
        }
    }
    throw lastError;
}

module.exports = retryOperation; 