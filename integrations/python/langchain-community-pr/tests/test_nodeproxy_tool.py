import unittest
from typing import Any
from unittest.mock import MagicMock, patch

from langchain_community.tools.nodeproxy.tool import NodeProxyMarkdownTool


class TestNodeProxyMarkdownTool(unittest.TestCase):
    @patch("langchain_community.tools.nodeproxy.tool.NodeProxyClient")
    def test_run_returns_markdown(self, mock_client_cls: Any) -> None:
        mock_client = MagicMock()
        mock_client.parse_url_text.return_value = "# Example"
        mock_client_cls.return_value = mock_client

        tool = NodeProxyMarkdownTool(client=mock_client)
        result = tool.invoke({"url": "https://example.com"})

        assert result == "# Example"
        mock_client.parse_url_text.assert_called_once_with("https://example.com")


if __name__ == "__main__":
    unittest.main()
