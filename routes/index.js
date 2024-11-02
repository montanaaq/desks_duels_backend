const express = require('express');
const router = express.Router();


router.get('/', (req, res) => {
    res.send('API от @montaanaq для проекта Desks Duels, используйте обратные вызовы API для обработки запросов');
});

module.exports = router;