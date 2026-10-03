-- Category taxonomy seed (mirrors js/core/classifier.js CATEGORY_TREE)
INSERT INTO categories (name, is_essential) VALUES
 ('Food & Dining',false),('Transport',true),('Shopping',false),('Housing',true),('Bills & Utilities',true),('Entertainment',false),('Health',true),
 ('Travel',false),('Education',true),('Finance',true),('Investment',false),('Income',false),('Transfers',false),('Cash',false),('Other',false)
ON CONFLICT DO NOTHING;
