"""
REG24 Official Python SDK (API04 / Gate G3)
Generated from OpenAPI 3.1 & MCP Tool Schema Catalogue (Section 10 & Section 11)
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
import json
import urllib.request


@dataclass
class Reg24CanonicalRequest:
    request_id: str
    tenant_id: str
    workspace_id: str
    jurisdiction_code: str
    legal_as_of: str
    known_as_of: str
    matter_id: Optional[str] = None
    idempotency_key: Optional[str] = None
    payload: Dict[str, Any] = field(default_factory=dict)


class Reg24PythonClient:
    """Headless Python Client for REG24 Infrastructure v1.0 (REST & MCP)"""

    def __init__(
        self,
        base_url: str,
        tenant_id: str,
        workspace_id: str = "workspace.law24.default",
        api_key: Optional[str] = None,
        jurisdiction_code: str = "TH",
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.tenant_id = tenant_id
        self.workspace_id = workspace_id
        self.api_key = api_key
        self.jurisdiction_code = jurisdiction_code

    def _headers(self, idempotency_key: Optional[str] = None) -> Dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "X-REG24-Tenant": self.tenant_id,
            "X-REG24-Workspace": self.workspace_id,
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        return headers

    def legal_search(self, query: str, legal_as_of: str, known_as_of: Optional[str] = None) -> Dict[str, Any]:
        body = json.dumps(
            {
                "tenant_id": self.tenant_id,
                "workspace_id": self.workspace_id,
                "jurisdiction_code": self.jurisdiction_code,
                "legal_as_of": legal_as_of,
                "known_as_of": known_as_of or legal_as_of,
                "query": query,
            }
        ).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url}/api/v1/legal/search",
            data=body,
            headers=self._headers(),
            method="POST",
        )
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
