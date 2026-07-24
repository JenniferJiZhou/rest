[CmdletBinding()]
param(
    [string]$BaseUrl,
    [ValidateSet("Https", "LocalHttp")]
    [string]$Mode = "Https",
    [ValidateSet("real", "mock", "cached")]
    [string]$ExpectedDataOrigin = "mock",
    [switch]$AllowSimulatedSend,
    [ValidateRange(1, 120)]
    [int]$TimeoutSeconds = 5
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
    Write-Error "FAIL: $Message"
    exit 1
}

if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
    Fail "BaseUrl must be supplied explicitly; no network request was made."
}

$parsedBaseUrl = $null
if (-not [Uri]::TryCreate($BaseUrl, [UriKind]::Absolute, [ref]$parsedBaseUrl)) {
    Fail "BaseUrl must be an absolute URL."
}
if ($Mode -eq "Https" -and $parsedBaseUrl.Scheme -ne "https") {
    Fail "HTTPS smoke requires an https BaseUrl."
}
if ($Mode -eq "LocalHttp") {
    $localHosts = @("localhost", "127.0.0.1", "::1")
    if ($parsedBaseUrl.Scheme -ne "http" -or $parsedBaseUrl.Host -notin $localHosts) {
        Fail "LocalHttp mode accepts only loopback http URLs."
    }
}
if ($AllowSimulatedSend -and $ExpectedDataOrigin -ne "mock") {
    Fail "AllowSimulatedSend requires ExpectedDataOrigin=mock."
}

Add-Type -AssemblyName System.Net.Http
$client = [System.Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds)
$base = $BaseUrl.TrimEnd("/")

function HeaderValue(
    [System.Net.Http.HttpResponseMessage]$Response,
    [string]$Name
) {
    $values = $null
    if (-not $Response.Headers.TryGetValues($Name, [ref]$values)) {
        Fail "response is missing $Name."
    }
    return @($values)[0]
}

function SendJson(
    [string]$Method,
    [string]$Path,
    [hashtable]$Headers,
    [object]$Payload
) {
    $request = [System.Net.Http.HttpRequestMessage]::new(
        [System.Net.Http.HttpMethod]::new($Method),
        "$base$Path"
    )
    foreach ($entry in $Headers.GetEnumerator()) {
        [void]$request.Headers.TryAddWithoutValidation(
            $entry.Key,
            [string]$entry.Value
        )
    }
    if ($null -ne $Payload) {
        $json = $Payload | ConvertTo-Json -Depth 10 -Compress
        $request.Content = [System.Net.Http.StringContent]::new(
            $json,
            [Text.Encoding]::UTF8,
            "application/json"
        )
    }
    try {
        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        return [pscustomobject]@{
            Response = $response
            Body = $body
        }
    }
    catch {
        Fail "request timed out or failed before an HTTP response was received."
    }
    finally {
        $request.Dispose()
    }
}

function NewRequestId([string]$Label) {
    $suffix = [Guid]::NewGuid().ToString("N")
    return "req_smoke_inbox_${Label}_$suffix"
}

function ProtocolHeaders([string]$RequestId) {
    return @{
        "X-Request-ID" = $RequestId
        "X-Client-Version" = "1.0.0-unified-inbox-smoke"
        "X-Contract-Version" = "1.0"
    }
}

function MutationHeaders([string]$RequestId) {
    $headers = ProtocolHeaders $RequestId
    $headers["Idempotency-Key"] = "idem-inbox-$([Guid]::NewGuid().ToString('N'))"
    return $headers
}

function AssertStatus(
    [object]$Result,
    [int]$ExpectedStatus,
    [string]$Label
) {
    if ([int]$Result.Response.StatusCode -ne $ExpectedStatus) {
        Fail "$Label returned HTTP $([int]$Result.Response.StatusCode), expected $ExpectedStatus."
    }
}

function AssertProtocol(
    [object]$Result,
    [string]$RequestId,
    [string]$Label
) {
    if ((HeaderValue $Result.Response "X-Request-ID") -ne $RequestId) {
        Fail "$Label returned a mismatched X-Request-ID."
    }
    if ((HeaderValue $Result.Response "X-Contract-Version") -ne "1.0") {
        Fail "$Label returned an unexpected Contract version."
    }
    if ((HeaderValue $Result.Response "X-Hush-Data-Origin") -ne $ExpectedDataOrigin) {
        Fail "$Label returned an unexpected data origin."
    }
    $body = $Result.Body | ConvertFrom-Json
    if ($body.request_id -ne $RequestId) {
        Fail "$Label returned a mismatched body request_id."
    }
    return $body
}

try {
    $health = SendJson "GET" "/v1/health" @{} $null
    AssertStatus $health 200 "health"
    $healthBody = $health.Body | ConvertFrom-Json
    if ($healthBody.status -ne "ok" -or $healthBody.contract_version -ne "1.0") {
        Fail "health response is not Contract-compatible."
    }

    $listId = NewRequestId "list"
    $list = SendJson "GET" "/v1/inbox/items" (ProtocolHeaders $listId) $null
    AssertStatus $list 200 "items list"
    $listBody = AssertProtocol $list $listId "items list"
    $item = @($listBody.items) |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_.draft_id) } |
        Select-Object -First 1
    if ($null -eq $item) {
        Fail "items list did not include an editable mock draft."
    }

    $detailId = NewRequestId "detail"
    $detail = SendJson "GET" "/v1/inbox/items/$($item.id)" (ProtocolHeaders $detailId) $null
    AssertStatus $detail 200 "item detail"
    $detailBody = AssertProtocol $detail $detailId "item detail"
    if ($detailBody.item.id -ne $item.id) {
        Fail "item detail returned a different item."
    }

    $draftId = NewRequestId "draft"
    $draft = SendJson "GET" "/v1/inbox/drafts/$($item.draft_id)" (ProtocolHeaders $draftId) $null
    AssertStatus $draft 200 "draft read"
    $draftBody = AssertProtocol $draft $draftId "draft read"
    $expectedVersion = [int]$draftBody.draft.version

    $patchId = NewRequestId "patch"
    $patchPayload = @{
        schema_version = "1.0"
        request_id = $patchId
        operation = "update_body"
        expected_version = $expectedVersion
        body = "Synthetic Unified Inbox smoke reply."
    }
    $patch = SendJson "PATCH" "/v1/inbox/drafts/$($item.draft_id)" (MutationHeaders $patchId) $patchPayload
    AssertStatus $patch 200 "draft update"
    $patchBody = AssertProtocol $patch $patchId "draft update"
    if ([int]$patchBody.draft.version -ne ($expectedVersion + 1)) {
        Fail "draft update did not increment version exactly once."
    }
    $confirmedVersion = [int]$patchBody.draft.version

    $confirmationId = NewRequestId "confirmation"
    $confirmationPayload = @{
        schema_version = "1.0"
        request_id = $confirmationId
        expected_version = $confirmedVersion
    }
    $confirmation = SendJson "POST" "/v1/inbox/drafts/$($item.draft_id)/confirmation" (MutationHeaders $confirmationId) $confirmationPayload
    AssertStatus $confirmation 201 "confirmation"
    $confirmationBody = AssertProtocol $confirmation $confirmationId "confirmation"
    if ([int]$confirmationBody.confirmation.draft_version -ne $confirmedVersion) {
        Fail "confirmation is not bound to the current draft version."
    }

    if ($AllowSimulatedSend) {
        $sendId = NewRequestId "send"
        $sendPayload = @{
            schema_version = "1.0"
            request_id = $sendId
            confirmation_id = $confirmationBody.confirmation.confirmation_id
            expected_version = $confirmedVersion
        }
        $send = SendJson "POST" "/v1/inbox/drafts/$($item.draft_id):send" (MutationHeaders $sendId) $sendPayload
        AssertStatus $send 200 "simulated send"
        $sendBody = AssertProtocol $send $sendId "simulated send"
        if ($sendBody.result.delivery_mode -ne "simulated") {
            Fail "mock send was not explicitly labelled simulated."
        }
        if ((HeaderValue $send.Response "X-Hush-Data-Origin") -ne "mock") {
            Fail "simulated send was incorrectly labelled real."
        }
    }

    Write-Output "PASS Unified Inbox smoke summary: health, list, detail, draft, update, confirmation validated."
    if ($AllowSimulatedSend) {
        Write-Output "PASS simulated send was explicitly enabled and remained mock/simulated."
    }
}
finally {
    $client.Dispose()
}
