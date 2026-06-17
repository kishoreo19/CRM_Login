const router = require('express').Router();
// TODO: Implement register routes
router.get('/', (req, res) => res.json({ success: true, data: [] }));
router.post('/', (req, res) => res.json({ success: true, message: 'register route placeholder' }));
module.exports = router;
