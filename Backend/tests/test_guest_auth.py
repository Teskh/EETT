from __future__ import annotations

import unittest
from urllib.parse import parse_qs, urlsplit

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import MembershipRole, Project, ProjectMembership, ProjectStatus, Role, User, UserRole
from app.services.auth import (
    attach_microsoft_identity,
    get_user_by_microsoft_identity,
    provision_microsoft_guest_user,
    require_guest_request_access,
    role_codes,
)
from app.services.projects import get_projects_page_data
from app.services.microsoft_auth import MicrosoftAuthConfig, authorize_url
from app.services.user_admin import update_user, validate_assignable_role_codes


class GuestAuthTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.session = sessionmaker(bind=self.engine, expire_on_commit=False)()
        self.session.add_all(
            [
                Role(code="guest", name="Invitado"),
                Role(code="editor", name="Editor"),
                Project(name="Template", status=ProjectStatus.TEMPLATE),
                Project(name="Execution", status=ProjectStatus.EXECUTION),
                Project(name="Finished", status=ProjectStatus.FINISHED),
            ]
        )
        self.session.commit()

    def tearDown(self) -> None:
        self.session.close()
        self.engine.dispose()

    def test_provisioned_guest_is_individual_read_only_and_execution_scoped(self) -> None:
        user = provision_microsoft_guest_user(
            self.session,
            tenant_id="tenant",
            object_id="object",
            email="new.person@example.com",
            display_name="New Person",
        )
        finished = next(project for project in self.session.query(Project).all() if project.status == ProjectStatus.FINISHED)
        self.session.add(ProjectMembership(project=finished, user=user, role=MembershipRole.VIEWER))
        self.session.commit()

        self.assertEqual(role_codes(user), {"guest"})
        self.assertTrue(user.is_auto_provisioned)
        self.assertEqual(
            get_user_by_microsoft_identity(self.session, tenant_id="tenant", object_id="object").id,
            user.id,
        )

        board = get_projects_page_data(self.session, user=user)
        self.assertEqual([project["name"] for project in board["grouped_projects"]["execution"]], ["Execution"])
        self.assertEqual(board["grouped_projects"]["template"], [])
        self.assertEqual(board["grouped_projects"]["finished"], [])

        require_guest_request_access(user, method="GET", path="/api/v1/projects/2")
        require_guest_request_access(user, method="GET", path="/api/v1/activity")
        with self.assertRaises(HTTPException):
            require_guest_request_access(user, method="POST", path="/api/v1/projects/2/comments")

    def test_existing_user_keeps_role_when_microsoft_identity_is_linked(self) -> None:
        editor_role = self.session.query(Role).filter_by(code="editor").one()
        user = User(username="editor", display_name="Editor", email="editor@example.com")
        user.roles.append(UserRole(role=editor_role))
        self.session.add(user)
        self.session.commit()

        linked = attach_microsoft_identity(self.session, user, tenant_id="tenant", object_id="editor-object")

        self.assertEqual(role_codes(linked), {"editor"})
        self.assertFalse(linked.is_auto_provisioned)
        self.assertEqual(linked.microsoft_object_id, "editor-object")

    def test_guest_can_be_promoted_but_cannot_be_combined_with_another_role(self) -> None:
        user = provision_microsoft_guest_user(
            self.session,
            tenant_id="tenant",
            object_id="promote-object",
            email="promote@example.com",
            display_name="Promote Me",
        )
        with self.assertRaises(ValueError):
            validate_assignable_role_codes(["guest", "editor"])

        promoted = update_user(
            self.session,
            user_id=user.id,
            display_name=user.display_name,
            email=user.email,
            password=None,
            role_codes_to_assign=["editor"],
            is_active=True,
        )

        self.assertEqual(role_codes(promoted), {"editor"})

    def test_microsoft_login_is_restricted_to_organizational_account_discovery(self) -> None:
        config = MicrosoftAuthConfig(
            tenant_id="tenant",
            client_id="client",
            client_secret="secret",
            redirect_uri="https://app.example.com/api/v1/auth/microsoft/callback",
        )

        query = parse_qs(urlsplit(authorize_url(config, state="state")).query)

        self.assertEqual(query["domain_hint"], ["organizations"])
        self.assertEqual(query["prompt"], ["select_account"])


if __name__ == "__main__":
    unittest.main()
