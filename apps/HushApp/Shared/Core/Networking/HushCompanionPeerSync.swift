import Foundation
import MultipeerConnectivity

struct HushCompanionDecision: Codable, Equatable {
    let id: String
    let decidedAt: Date
    let shouldOfferRest: Bool
    let reasonCode: String
    let message: String
    let defaultQuestID: String?
}

struct HushCompanionSnapshot: Codable, Equatable {
    static let protocolVersion = 2

    let protocolVersion: Int
    let sessionID: String
    let sequence: Int
    let emittedAt: Date
    let deviceName: String
    let currentContext: String
    let continuousScreenSeconds: Int
    let continuousAppSeconds: Int
    let dailySeconds: Int
    let isMonitoring: Bool
    let interruptionMode: String
    let latestDecision: HushCompanionDecision?
}

struct HushCompanionCommand: Codable, Equatable {
    enum Kind: String, Codable {
        case restStarted
        case remindLater
        case suggestionDismissed
        case restCompleted
    }

    let kind: Kind
    let decisionID: String?
    let emittedAt: Date
}

final class HushCompanionPeerTransport: NSObject {
    enum Role {
        case macBroadcaster
        case phoneReceiver
    }

    enum ConnectionState: Equatable {
        case stopped
        case searching
        case connected(String)
    }

    var onSnapshot: ((HushCompanionSnapshot) -> Void)?
    var onCommand: ((HushCompanionCommand) -> Void)?
    var onConnectionStateChanged: ((ConnectionState) -> Void)?

    private static let serviceType = "hush-companion"

    private let role: Role
    private let peerID: MCPeerID
    private let session: MCSession
    private var advertiser: MCNearbyServiceAdvertiser?
    private var browser: MCNearbyServiceBrowser?
    private var hasStarted = false

    init(role: Role, displayName: String) {
        self.role = role
        peerID = MCPeerID(displayName: String(displayName.prefix(63)))
        session = MCSession(
            peer: peerID,
            securityIdentity: nil,
            encryptionPreference: .required
        )
        super.init()
        session.delegate = self
    }

    func start() {
        guard !hasStarted else {
            return
        }
        hasStarted = true
        publishConnectionState(.searching)

        switch role {
        case .macBroadcaster:
            let advertiser = MCNearbyServiceAdvertiser(
                peer: peerID,
                discoveryInfo: ["role": "mac"],
                serviceType: Self.serviceType
            )
            advertiser.delegate = self
            self.advertiser = advertiser
            advertiser.startAdvertisingPeer()
        case .phoneReceiver:
            let browser = MCNearbyServiceBrowser(
                peer: peerID,
                serviceType: Self.serviceType
            )
            browser.delegate = self
            self.browser = browser
            browser.startBrowsingForPeers()
        }
    }

    func stop() {
        guard hasStarted else {
            return
        }
        hasStarted = false
        advertiser?.stopAdvertisingPeer()
        browser?.stopBrowsingForPeers()
        advertiser = nil
        browser = nil
        session.disconnect()
        publishConnectionState(.stopped)
    }

    func send(snapshot: HushCompanionSnapshot) {
        send(envelope: Envelope(snapshot: snapshot, command: nil))
    }

    func send(command: HushCompanionCommand) {
        send(envelope: Envelope(snapshot: nil, command: command))
    }

    private func send(envelope: Envelope) {
        let peers = session.connectedPeers
        guard !peers.isEmpty, let data = try? JSONEncoder().encode(envelope) else {
            return
        }

        try? session.send(data, toPeers: peers, with: .reliable)
    }

    private func publishConnectionState(_ state: ConnectionState) {
        DispatchQueue.main.async { [weak self] in
            self?.onConnectionStateChanged?(state)
        }
    }
}

extension HushCompanionPeerTransport: MCNearbyServiceAdvertiserDelegate {
    func advertiser(
        _ advertiser: MCNearbyServiceAdvertiser,
        didReceiveInvitationFromPeer peerID: MCPeerID,
        withContext context: Data?,
        invitationHandler: @escaping (Bool, MCSession?) -> Void
    ) {
        invitationHandler(true, session)
    }

    func advertiser(
        _ advertiser: MCNearbyServiceAdvertiser,
        didNotStartAdvertisingPeer error: Error
    ) {
        publishConnectionState(.stopped)
    }
}

extension HushCompanionPeerTransport: MCNearbyServiceBrowserDelegate {
    func browser(
        _ browser: MCNearbyServiceBrowser,
        foundPeer peerID: MCPeerID,
        withDiscoveryInfo info: [String: String]?
    ) {
        guard
            session.connectedPeers.isEmpty,
            info?["role"] == "mac"
        else {
            return
        }

        browser.invitePeer(
            peerID,
            to: session,
            withContext: nil,
            timeout: 10
        )
    }

    func browser(
        _ browser: MCNearbyServiceBrowser,
        lostPeer peerID: MCPeerID
    ) {}

    func browser(
        _ browser: MCNearbyServiceBrowser,
        didNotStartBrowsingForPeers error: Error
    ) {
        publishConnectionState(.stopped)
    }
}

extension HushCompanionPeerTransport: MCSessionDelegate {
    func session(
        _ session: MCSession,
        peer peerID: MCPeerID,
        didChange state: MCSessionState
    ) {
        switch state {
        case .connected:
            publishConnectionState(.connected(peerID.displayName))
        case .connecting:
            publishConnectionState(.searching)
        case .notConnected:
            publishConnectionState(hasStarted ? .searching : .stopped)
        @unknown default:
            publishConnectionState(.searching)
        }
    }

    func session(
        _ session: MCSession,
        didReceive data: Data,
        fromPeer peerID: MCPeerID
    ) {
        guard let envelope = try? JSONDecoder().decode(
            Envelope.self,
            from: data
        ) else {
            return
        }

        DispatchQueue.main.async { [weak self] in
            if let snapshot = envelope.snapshot {
                self?.onSnapshot?(snapshot)
            }
            if let command = envelope.command {
                self?.onCommand?(command)
            }
        }
    }

    func session(
        _ session: MCSession,
        didReceive stream: InputStream,
        withName streamName: String,
        fromPeer peerID: MCPeerID
    ) {}

    func session(
        _ session: MCSession,
        didStartReceivingResourceWithName resourceName: String,
        fromPeer peerID: MCPeerID,
        with progress: Progress
    ) {}

    func session(
        _ session: MCSession,
        didFinishReceivingResourceWithName resourceName: String,
        fromPeer peerID: MCPeerID,
        at localURL: URL?,
        withError error: Error?
    ) {}
}

private struct Envelope: Codable {
    let snapshot: HushCompanionSnapshot?
    let command: HushCompanionCommand?
}
