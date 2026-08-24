// The main chain is walked from the session's tip. Rewound sessions leave an
// abandoned branch among the newest nodes, so table order is not conversation
// order.
export const DEVIN_CHAIN_QUERY = `
  WITH RECURSIVE chain (node_id, parent_node_id, chat_message, depth) AS (
    SELECT node_id, parent_node_id, chat_message, 0
    FROM message_nodes
    WHERE session_id = ?1 AND node_id = ?2
    UNION ALL
    SELECT nodes.node_id, nodes.parent_node_id, nodes.chat_message, chain.depth + 1
    FROM message_nodes AS nodes
    JOIN chain ON nodes.node_id = chain.parent_node_id
    WHERE nodes.session_id = ?1 AND chain.depth < ?3
  )
  SELECT chat_message FROM chain ORDER BY depth
`;
