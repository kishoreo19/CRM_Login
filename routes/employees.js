const router = require('express').Router();
// TODO: Implement employees routes
router.get('/', (req, res) => res.json({ success: true, data: [] }));
router.post('/', (req, res) => res.json({ success: true, message: 'employees route placeholder' }));
module.exports = router;
