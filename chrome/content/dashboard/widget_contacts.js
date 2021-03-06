/*
 * Copyright 2008-2009 by Massimiliano Mirra
 *
 * This file is part of SamePlace.
 *
 * SamePlace is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the
 * Free Software Foundation; either version 3 of the License, or (at your
 * option) any later version.
 *
 * SamePlace is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * The interactive user interfaces in modified source and object code
 * versions of this program must display Appropriate Legal Notices, as
 * required under Section 5 of the GNU General Public License version 3.
 *
 * In accordance with Section 7(b) of the GNU General Public License
 * version 3, modified versions must display the "Powered by SamePlace"
 * logo to users in a legible manner and the GPLv3 text must be made
 * available to them.
 *
 * Author: Massimiliano Mirra, <bard [at] hyperstruct [dot] net>
 *
 */


// INITIALIZATION/FINALIZATION
// ----------------------------------------------------------------------

window.addEventListener('dashboard/load', function(event) {
    // For some reason, the console won't display errors happening in
    // the dashboard/load and dashboard/unload handlers, so we force it.
    try { contacts.init(); } catch(e) { Cu.reportError(e); }
}, false);

window.addEventListener('dashboard/unload', function(event) {
    try { contacts.finish(); } catch(e) { Cu.reportError(e); }
}, false);

var contacts = {};

contacts.init = function() {
    this._srvIO = Cc['@mozilla.org/network/io-service;1']
        .getService(Ci.nsIIOService);

    this._pref = Cc['@mozilla.org/preferences-service;1']
        .getService(Ci.nsIPrefService)
        .getBranch('extensions.sameplace.widget.contacts.');

    this._prompt = Cc['@mozilla.org/embedcomp/prompt-service;1']
        .getService(Ci.nsIPromptService);

    this._channel = XMPP.createChannel();

    this._channel.on(
        function(ev) (ev.name == 'iq' &&
                      ev.dir == 'in' &&
                      ev.type == 'result' &&
                      ev.xml..ns_vcard::PHOTO != null),
        function(iq) {
            var xulConcreteContact = contacts._findConcreteContact(iq.account, XMPP.JID(iq.from).address);
            if(!xulConcreteContact)
                return;
            var xulAvatar = $(xulConcreteContact, '^ .contact .avatar');
            var xmlPhoto = iq.xml..ns_vcard::PHOTO;
            xulAvatar.setAttribute('src', 'data:' + xmlPhoto.ns_vcard::TYPE + ';base64,' +
                                   xmlPhoto.ns_vcard::BINVAL);
        });

    this._channel.on(
        function(ev) (ev.name == 'iq' &&
                      ev.dir == 'in' &&
                      ev.xml.ns_roster::query != null),
        function(iq) {
            for each(var item in iq.stanza..ns_roster::item) {
                contacts.updateContactItem(iq.account,
                                           item.@jid.toString(),
                                           item.@name.toString(),
                                           item.@subscription.toString());
            }
        });

    // this._channel.on(
    //     function(ev) (ev.name == 'iq' &&
    //            ev.dir == 'in' &&
    //            ev.xml.ns_roster::query != null &&
    //            (ev.type == 'result' ||
    //             // Don't accept roster pushes from strangers
    //             (ev.type == 'set' && ev.from == ev.account))),
    //     function(iq) {
    //         for each(var item in iq.xml..ns_roster::item) {
    //             switch(item.@subscription.toString()) {
    //             case 'both':
    //             case 'to':
    //                 views.roster['xmpp://' + iq.account + '/' + item.@jid] = item;
    //                 break;
    //             default:
    //                 delete views.roster['xmpp://' + iq.account + '/' + item.@jid];
    //                 break;
    //             }
    //         }
    //     });

    // this._channel.on(
    //     function(ev) (ev.name == 'presence' &&
    //            ev.dir == 'in' &&
    //            (!ev.type || ev.type == 'unavailable')),
    //     function(presence) {
    //         var uri = 'xmpp://' + presence.account + '/' + XMPP.JID(presence.from).address;
    //         if(!(uri in views.presence))
    //             views.presence[uri] = [];

    //         views.presence[uri].unshift(presence.xml);
    //     }
    // )

    this._channel.on(
        function(ev) (ev.name == 'presence' &&
                      ev.dir == 'in' &&
                      (ev.type == 'unavailable' || !ev.type)),
        function(presence) contacts.receivedContactPresence(presence));

    this._channel.on(
        function(ev) (ev.name == 'presence' &&
                      ev.dir == 'in' &&
                      ev.type == 'subscribe'),
        function(presence) contacts.receivedSubscriptionRequest(presence));

    this._channel.on(
        function(ev) (ev.name == 'connector' &&
                      ev.state == 'active'),
        function(connector) {
            $('#widget-contacts').setAttribute('minimized', 'false');
        });

    this._channel.on(
        function(ev) (ev.name == 'connector' &&
                      ev.state == 'disconnected'),
        function(connector) {
            if(XMPP.accounts.every(XMPP.isDown))
                $('#widget-contacts').setAttribute('minimized', 'true');
        });

    this._displayMode = $('#widget-contacts-display-mode').value;
    this._refreshList();
};

contacts.finish = function() {
    this._channel.release();
};


// UTILITIES
// ----------------------------------------------------------------------

function eventFromDescendant(container, event) {
    var containee = event.relatedTarget;

    while(containee != null) {
        if(container == containee)
            return true;
        containee = containee.parentNode;
    }

    return false;
}

function delayAndAccumulate(fn, delay) {
    var delay = delay || 1000;
    var argSets = [];
    var timeout;

    return function() {
        if(timeout)
            window.clearTimeout(timeout);

        argSets.push(arguments);

        timeout = window.setTimeout(function() {
            try {
                fn(argSets);
            } catch(e) {
                Cu.reportError(e);
            } finally {
                argSets = [];
            }
        }, delay);
    }
}


// GUI ACTIONS
// ----------------------------------------------------------------------

contacts.updateContactPresence = function(presence) {
    var account = presence.account;
    var address = XMPP.JID(presence.stanza.@from).address;

    var xulConcreteContact = this._findConcreteContact(account, address);
    if(!xulConcreteContact)
        // We only want to update presence if a contact is in the UI already.
        return;

    // Grab most relevant presence of contact or, if none, use given presence
    //var presence = XMPP.presencesOf(account, address)[0] || presence;

    var xulContact = $(xulConcreteContact, '^ .contact');

    // TODO: there should be a way of deciding which is most relevant
    // presence among concrete contacts... for now we use the lazy way
    // and just use latest presence.
    xulContact
        .setAttribute('availability', (presence.stanza.@type == undefined ?
                                       'available' :
                                       presence.stanza.@type));
    xulContact
        .setAttribute('show', presence.stanza.show.toString());
    $(xulContact, '.status-message')
        .setAttribute('value', presence.stanza.status.toString());
};

contacts.updateContactItem = function(account, address, name, subscription) {
    name = name || address;

    // Removal from roster, removal from list of popular contacts
    // (when display mode is "popular"), and update of offline contact
    // (when display mode is "online") is handled in essentially the
    // same way: remove concrete contact (if any), remove contact (if
    // concrete contact was last one), and return early.

    if(subscription == 'remove') {
        this._removeConcreteContact(account, address);
        return;
    }

    if(this._displayMode == 'popular' &&
       !sameplace.services.contacts.isPopular(account, address)) {
        this._removeConcreteContact(account, address);
        return;
    }

    var contactPresence = (XMPP.presencesOf(account, address)[0] ||
                           XMPP.packet(<presence from={address} type='unavailable'>
                                       <meta xmlns={ns_x4m_in} direction='in' account={account}/>
                                       </presence>));

    if(this._displayMode == 'online' &&
       contactPresence.stanza.@type != undefined) {
        this._removeConcreteContact(account, address);
        return;
    }

    // If contact isn't in our roster, we don't want to display it.
    // (This isn't necessarily against malicious users -- for example,
    // XMPP-compliant servers bounce our presence back when we sign
    // on.)
    if(this._getRosterItem(account, address) == undefined)
        return;

    // Most of the logic below is for deducing whether this is a
    // rename or addition

    var xulContact = this._findContact(name);
    if(xulContact) {
        // Metacontact was found.  Either we need to move an existing
        // concrete contact to the metacontact, or we need to add one.

        var xulConcreteContact = this._findConcreteContact(account, address);
        if(xulConcreteContact) {
            // Move existing concrete contact (and remove containing
            // metacontact if no more concrete contacts are under it)

            var xulConcreteContactDst = $(xulContact, '.concrete-contacts');
            var xulConcreteContactSrc = xulConcreteContact.parentNode;

            xulConcreteContactDst.appendChild(xulConcreteContact);
            if(xulConcreteContactSrc.childNodes.length == 0) {
                var xulContactSrc = $(xulConcreteContactSrc, '^ .contact');
                xulContactSrc.parentNode.removeChild(xulContactSrc);
            }
        } else {
            // Create new concrete contact

            xulConcreteContact = this._makeConcreteContact(account, address);
            $(xulContact, '.concrete-contacts').appendChild(xulConcreteContact);
        }
    } else {
        // Contact wasn't found by name in the XUL list, thus either
        // it's a new contact altogether, or an existing contact was
        // renamed.

        xulContact = this._makeContact(name);
        var xulConcreteContactDst = $(xulContact, '.concrete-contacts');

        var xulConcreteContact = this._findConcreteContact(account, address);
        if(xulConcreteContact) {
            // Concrete contact is already there, use it (meaning this is a rename)
            var xulConcreteContactSrc = xulConcreteContact.parentNode;

            xulConcreteContactDst.appendChild(xulConcreteContact);

            if(xulConcreteContactSrc.childNodes.length == 0) {
                var xulContactSrc = $(xulConcreteContactSrc, '^ .contact');
                xulContactSrc.parentNode.removeChild(xulContactSrc);
            }
        } else {
            // No concrete contact, create it (user added new contact)
            xulConcreteContact = this._makeConcreteContact(account, address);
            xulConcreteContactDst.appendChild(xulConcreteContact);
        }

        this._sortedInsert(xulContact, $('#widget-contacts .list'), 'name');
    }

    this.updateContactPresence(contactPresence);
};

contacts.changeDisplayMode = function(event) {
    var mode = event.target.value;
    if(this._displayMode === mode)
        return;

    this._displayMode = mode;
    this._refreshList();

    if(mode === 'popular' &&
       this._pref.getBoolPref('displayPopularContactsHelp')) {
        var stopDisplayingAlert = { value: false };
        this._prompt.alertCheck(null, 'Changing contacts display mode',
                                '"Popular" contacts are those you chat with most often.\n\n' +
                                'If you just installed SamePlace, the list will be empty; use\n' +
                                'the search field to add some contacts manually.\n',
                                'Do not display this help message in the future.',
                                stopDisplayingAlert);
        if(stopDisplayingAlert.value === true)
            this._pref.setBoolPref('displayPopularContactsHelp', false);
    }
};


// GUI REACTIONS
// ----------------------------------------------------------------------

contacts.clickedContact = function(xulContactDescendant) {
    if(this._contactHoverTimeout)
        window.clearTimeout(this._contactHoverTimeout);

    $('#contact-popup').hidePopup();

    var xulContact = $(xulContactDescendant, '^ .contact');

    // XXX Defaults to first concrete contact... not necessarily the
    // best choice!

    var xulConcreteContact = $(xulContact, '.concrete-contact');
    var account = xulConcreteContact.getAttribute('account');
    var address = xulConcreteContact.getAttribute('address');

    this._srvIO.newChannel('xmpp://' + account + '/' + address,
                           null,
                           null)
        .asyncOpen(null, null);
};

contacts.requestedHideContact = function(event) {
    $('#contact-popup').hidePopup();

    var xulConcreteContact = $('#contact-popup .concrete-contacts').firstChild;
    while(xulConcreteContact) {
        this.removeFromPopular(xulConcreteContact.getAttribute('account'),
                               xulConcreteContact.getAttribute('address'));
        xulConcreteContact = xulConcreteContact.nextSibling;
    }
};

contacts.requestedRemoveContact = function(event) {
    $('#contact-popup').hidePopup();

    var request = {
        concreteContacts: []
    };
    var xulConcreteContact = $('#contact-popup .concrete-contacts').firstChild;
    while(xulConcreteContact) {
        request.concreteContacts.push({
            account: xulConcreteContact.getAttribute('account'),
            address: xulConcreteContact.getAttribute('address')
        });
        xulConcreteContact = xulConcreteContact.nextSibling;
    }

    window.openDialog('chrome://sameplace/content/dialogs/remove_contacts.xul',
                      'SamePlace:RemoveContacts', 'modal', request);

};

contacts.requestedRenameContact = function(event, useNickAsPreset) {
    var xulPopup = $('#contact-popup');
    var xulContact = document.popupNode;

    xulPopup.hidePopup();

    var newName = useNickAsPreset ?
        $(xulPopup, '.nick').getAttribute('value') :
        window.prompt('Rename contact', $(xulPopup, '.name').getAttribute('value'));

    var xulConcreteContact = $(xulContact, '.concrete-contact');
    while(xulConcreteContact) {
        var account = xulConcreteContact.getAttribute('account');
        var address = xulConcreteContact.getAttribute('address');

        if(newName && newName.replace(/(^\s*|\s*$)/g, '') != '')
            XMPP.send(account,
                      <iq type='set'>
                      <query xmlns='jabber:iq:roster'>
                      <item jid={address} name={newName}/>
                      </query>
                      </iq>);

        xulConcreteContact = xulConcreteContact.nextSibling;
    }
};


// NETWORK REACTIONS
// ----------------------------------------------------------------------

contacts.receivedContactPresence = function(presence) {
    if(this._displayMode == 'online') {
        var account = presence.account;
        var address = XMPP.JID(presence.stanza.@from).address;
        var name = this._getRosterItem(account, address).@name.toString();
        this.updateContactItem(account, address, name);
    }

    this.updateContactPresence(
        XMPP.presencesOf(
            presence.account,
            XMPP.JID(presence.stanza.@from).address)[0] || presence);
};

contacts.receivedSubscriptionRequest = delayAndAccumulate(function(argSets) {
    var presences = argSets.map(function([presence]) presence);

    dashboard.notify(presences.length + ' request(s) pending',
                     'subscription-request',
                     null,
                     'info_high',
                     [{label: 'View', accessKey: 'V', callback: viewRequest}]);

    function viewRequest() {
        var request = { };
        request.choice = false;
        request.contacts = presences.map(function(presence) [presence.account,
                                                      XMPP.JID(presence.stanza.@from).address,
                                                      true]);
        request.description = 'These contacts want to add you to their contact list. Do you accept?';

        window.openDialog(
            'chrome://sameplace/content/dialogs/contact_selection.xul',
            'contact-selection',
            'modal,centerscreen', request);

        if(request.choice == true) {
            for each(let [account, address, authorize] in request.contacts) {
                if(authorize) {
                    contacts.acceptSubscriptionRequest(account, address);
                    let xmlRosterItem = contacts._getRosterItem(account, address);
                    if(xmlRosterItem == undefined ||
                       xmlRosterItem.@subscription == 'none' ||
                       xmlRosterItem.@subscription == 'from') {
                        // contact not yet in our contact list, request
                        // auth to make things even ;-)
                        contacts.requestPresenceSubscription(account, address);
                    }
                } else {
                    contacts.denySubscriptionRequest(account, address);
                }
            }
        } else {
            for each(let [account, address, authorize] in request.contacts) {
                contacts.denySubscriptionRequest(account, address);
            }
        }
    }
});


// NETWORK ACTIONS
// ----------------------------------------------------------------------

contacts.addContact = function(account, address, subscribe) {
    XMPP.send(account,
              <iq type='set'>
              <query xmlns={ns_roster}>
              <item jid={address}/>
              </query>
              </iq>);

    if(subscribe)
        XMPP.send(account, <presence to={address} type='subscribe'/>);
};

contacts.requestPresenceSubscription = function(account, address) {
    XMPP.send(account, <presence to={address} type="subscribe"/>);
};

contacts.acceptSubscriptionRequest = function(account, address) {
    XMPP.send(account, <presence to={address} type="subscribed"/>);
};

contacts.denySubscriptionRequest = function(account, address) {
    XMPP.send(account, <presence to={address} type="unsubscribed"/>);
};


// SEARCH/COMPLETION
// ----------------------------------------------------------------------

contacts.enteredSearchText = function(s) {
    // Wrap everything in a try() because the XBL that calls this
    // handler seems to swallow errors.
    try {
        var searchString = s.replace(/(^\s*|\s*$)/g, '');
        $('#widget-contacts-search').value = '';
        document.commandDispatcher.advanceFocus();

        var entity = XMPP.entity(s);

        if(!entity.action) {
            if(entity.account && entity.address) {
                let xmlRosterItem = this._getRosterItem(entity.account,
                                                        entity.address);
                if(!xmlRosterItem)
                    alert('entity not in roster');

                this.addToPopular(entity.account,
                                  xmlRosterItem.@jid.toString(),
                                  xmlRosterItem.@name.toString());
            }
            else
                alert('unimplemented');
        } else if(entity.action == 'roster') {
            var request = {
                contactAddress: entity.address,
                subscribeToPresence: undefined,
                confirm: false,
                account: undefined
            };

            window.openDialog(
                'chrome://sameplace/content/dialogs/add_contact.xul',
                'im:add-contact', 'modal,centerscreen',
                request);

            // XXX this should really be done by the dialog itself

            if(request.confirm)
                this.addContact(request.account,
                                request.contactAddress,
                                request.subscribeToPresence);
        }

    } catch(e) {
        Cu.reportError(e);
    }
};

contacts.removeFromPopular = function(account, address) {
    sameplace.services.contacts.makeUnpopular(account, address);
    var xmlRosterItem = this._getRosterItem(account, address);
    this.updateContactItem(account,
                           xmlRosterItem.@jid.toString(),
                           xmlRosterItem.@name.toString());
};

contacts.addToPopular = function(account, address, name) {
    sameplace.services.contacts.makePopular(account, address);
    this.updateContactItem(account, address, name);
};

// XXX currently unused

contacts.promptAddContact = function(account, address) {
    if(window.confirm('"' + address + '" is not in your contact list.\n' +
                      'Do you want to add it as a contact?'))
        window.openDialog('chrome://sameplace/content/dialogs/add_contacts.xul',
                          'SamePlace:AddContacts', '', address);
};


// CONTACT POPUP
// ----------------------------------------------------------------------

contacts.hidingContactPopup = function(xulPopup) {
    $(xulPopup, '.no-photo').hidden = true;
    $(xulPopup, '.avatar').removeAttribute('src');
};

contacts.showingContactPopup = function(xulPopup) {

    // For some reason, document.popupNode isn't available when popup
    // was opened through openPopup()

    var xulContact = $(document.popupNode, '^ .contact');

    $(xulPopup, '.name').setAttribute('value', $(xulContact, '.name').getAttribute('value'));
    $(xulPopup, '.status-message').textContent = $(xulContact, '.status-message').getAttribute('value');
    $(xulPopup, '.nick-container').hidden = true;

    var xulPopupConcreteContacts = $(xulPopup, '.concrete-contacts');
    while(xulPopupConcreteContacts.lastChild)
        xulPopupConcreteContacts.removeChild(xulPopupConcreteContacts.lastChild);

    var xulConcreteContact = $(xulContact, '.concrete-contact');
    while(xulConcreteContact) {
        let xulLabel = xulConcreteContact.cloneNode(true);
        xulLabel.value = xulLabel.getAttribute('account') + ' → ' + xulLabel.value;
        xulLabel.setAttribute('crop', 'start')
        $(xulPopup, '.concrete-contacts').appendChild(xulLabel);
        xulConcreteContact = xulConcreteContact.nextSibling;
    }

    // Popup may hide while we are waiting for the vCard, and then
    // show up again but on another contact.  We don't want the
    // previous contact's photo to be displayed in the new contact's
    // popup, so we use a one-time handler to set a flag which will
    // later tell the retrieveVCardTask whether the popup has closed
    // in the meantime.

    popupHidden = false;
    xulPopup.addEventListener('popuphidden', function() {
        xulPopup.removeEventListener('popuphidden', arguments.callee, false);
        popupHidden = true;
    }, false);

    // XXX Retrieve vcard of first concrete contact... not necessarily
    // the best choice!

    var account = xulPopupConcreteContacts.childNodes[0].getAttribute('account');
    var address = xulPopupConcreteContacts.childNodes[0].getAttribute('address');

    var retrieveVCardTask = task(function(receive) {
        var iq = yield XMPP.req(
            account,
                <iq to={address} type='get'>
                <vCard xmlns='vcard-temp'/>
                <connection xmlns={ns_x4m_in} control='cache,remote-if-online'/>
                </iq>);

        if(iq.stanza.@type == 'error') {
            Cu.reportError(iq.stanza.toXMLString());
            return;
        }

        if(popupHidden)
            return;

        var xmlPhoto = iq.stanza..ns_vcard::PHOTO;
        if(xmlPhoto.ns_vcard::BINVAL != undefined)
            $(xulPopup, '.avatar').setAttribute(
                'src', 'data:' + xmlPhoto.ns_vcard::TYPE + ';base64,' +
                    xmlPhoto.ns_vcard::BINVAL);
        else if(xmlPhoto.ns_vcard::EXTVAL != undefined)
            $(xulPopup, '.avatar').setAttribute(
                'src', xmlPhoto.ns_vcard::EXTVAL);
        else
            $(xulPopup, '.no-photo').hidden = false;

        var nick = iq.stanza..ns_vcard::FN.text().toString();
        if($(xulContact, '.name').getAttribute('value') != nick) {
            $(xulPopup, '.nick-container').hidden = (nick == '')
            $(xulPopup, '.nick').setAttribute('value', nick);
        }
    });

    retrieveVCardTask.start();
};


// INTERNALS
// ----------------------------------------------------------------------

contacts._removeConcreteContact = function(account, address) {
    let xulConcreteContact = this._findConcreteContact(account, address);
    if(!xulConcreteContact)
        return;

    let xulConcreteContacts = xulConcreteContact.parentNode;
    let xulContact = $(xulConcreteContacts, '^ .contact');
    xulConcreteContacts.removeChild(xulConcreteContact);
    if(xulConcreteContacts.childNodes.length == 0)
        xulContact.parentNode.removeChild(xulContact);
};

contacts._refreshList = function() {
    var xulList = $('#widget-contacts .list');
    while(xulList.lastChild)
        xulList.removeChild(xulList.lastChild);

    XMPP.accounts.forEach(function(account) {
        task(contacts.taskdef_initList)
            .start()
            .send(account.jid);
    });
};

// Inserts a xulElement into a sorted nodeList, ordering by attrName.

contacts._sortedInsert = function(xulElement, nodeList, attrName) {
    var attrValue = xulElement.getAttribute(attrName);

    if(nodeList.childNodes.length == 0)
        nodeList.appendChild(xulElement);
    else if(attrValue.toLowerCase() >= nodeList.childNodes[nodeList.childNodes.length-1].getAttribute(attrName).toLowerCase())
        nodeList.appendChild(xulElement);
    else if(attrValue.toLowerCase() <= nodeList.firstChild.getAttribute(attrName).toLowerCase())
        nodeList.insertBefore(xulElement, nodeList.firstChild)
    else {
        var elementIter = nodeList.firstChild;
        while(elementIter.nextSibling) {
            if(attrValue > elementIter.getAttribute(attrName) &&
               attrValue <= elementIter.nextSibling.getAttribute(attrName)) {
                nodeList.insertBefore(xulElement, elementIter.nextSibling);
                break;
            }
            elementIter = elementIter.nextSibling;
        }
    }
};

contacts._findContact = function(name) {
    return $('#widget-contacts .list .contact[name="' + name + '"]');
};

contacts._makeContact = function(name) {
    var xulContact = $('#blueprints > .contact').cloneNode(true);
    xulContact.setAttribute('name', name);
    $(xulContact, '.name').setAttribute('value', name);
    return xulContact;
};

contacts._findConcreteContact = function(account, address) {
    return $('#widget-contacts .list .concrete-contact[account="' + account + '"][address="' + address + '"]');
};

contacts._makeConcreteContact = function(account, address) {
    var xulConcreteContact = document.createElement('label');
    xulConcreteContact.setAttribute('class', 'concrete-contact');
    xulConcreteContact.setAttribute('value', address);
    xulConcreteContact.setAttribute('account', account);
    xulConcreteContact.setAttribute('address', address);
    xulConcreteContact.setAttribute('crop', 'end');
    return xulConcreteContact;
};

contacts._getRosterItem = function(account, address) {
    // return XMPP.view(ns_roster)
    //     .get('xmpp://' + account + '/' + account)
    //     .stanza..ns_roster::item.(@jid == address);

    var roster = XMPP.cache.first(
        XMPP.q()
            .event('iq')
            .direction('in')
            .account(account)
            .child('jabber:iq:roster', 'query'));

    return roster.stanza..ns_roster::item.(@jid == address);
};


// TASKS
// ----------------------------------------------------------------------

contacts.taskdef_initList = function(receive) {
    var account = yield receive();

    var iq = yield XMPP.req(
        account,
            <iq type='get'>
            <query xmlns='jabber:iq:roster'/>
            <connection xmlns={ns_x4m_in} control='cache,remote-if-online'/>
            </iq>);

    for each(let item in iq.stanza..ns_roster::item) {
        contacts.updateContactItem(account,
                                   item.@jid.toString(),
                                   item.@name.toString());
    }

    // XMPP.view('presence/in/account').get(account)
    //     .forEach(function(presence) contacts.receivedContactPresence(presence));

    XMPP.cache
        .all(XMPP.q()
             .event('presence')
             .direction('in')
             .account(account))
        .forEach(function(presence) contacts.receivedContactPresence(presence));
};


// LAB AREA
// ----------------------------------------------------------------------

// Temporary.  Under consideration for inclusion in xmpp.js, possibly
// with task() or XMPP.task().  Connection control part under
// consideration for inclusion in client_service.js

XMPP.req = function(account, stanza) {
    return function(resume) {
        XMPP.sendPseudoSync(account, stanza, function(reply) resume(reply));
    }
};




XMPP.sendPseudoSync = function(account, stanza, replyHandler) {
    var connectionControl = stanza.ns_x4m_in::connection.@control.toString();

    if(!connectionControl)
        XMPP.send(account, stanza, replyHandler);
    else {
        let tmp = stanza.copy();
        delete tmp.ns_x4m_in::*;
        // Per RFC-3920, iq's of type="get" must contain only one
        // (namespaced) child indicating the semantics of the
        // request, thus we assume that once we've removed our
        // non-standard control element, we are left with the
        // semanticts-indicating child only.
        let child = tmp.*;

        let reply = XMPP.cache.first(
            XMPP.q()
                .event('iq')
                .account(account)
                .from(stanza.@to)
                .type('result')
                .direction('in')
                .child(child.namespace().toString(), child.name().localName));

        switch(connectionControl) {
        case 'cache,offline':
            if(reply)
                replyHandler(reply);
            else {
                var replyStanza = stanza.copy();
                replyStanza.@type = 'error';
                replyStanza.appendChild(<error xmlns={ns_x4m_in} type='ondemand-connection-refused'/>);
                replyStanza.appendChild(<meta xmlns={ns_x4m_in} account={account} direction='in'/>);
                replyHandler(XMPP.packet(replyStanza));
            }
            break;

        case 'cache,remote-if-online':
            if(reply)
                replyHandler(reply);
            else if(XMPP.isUp(account))
                XMPP.send(account, stanza, replyHandler);
            else {
                var replyStanza = tmp;
                replyStanza.@type = 'error';
                replyStanza.appendChild(<error xmlns={ns_x4m_in} type='cache-miss'/>);
                replyStanza.appendChild(<meta xmlns={ns_x4m_in} account={account} direction='in'/>);
                replyHandler(XMPP.packet(replyStanza));
            }
            break;

        case 'cache,remote-always':
            // TODO throw error if it's not an iq or if it's an iq-set
            // TODO investigate HTTP criteria for caching, they should be
            // similar

            if(reply)
                replyHandler(reply);
            else
                XMPP.send(account, stanza, replyHandler);
            break;

        default:
            throw new Error('Unknown value for <connection/>. (' + connectionControl + ')');
        }
    }
};

XMPP.packet = function(xmlStanza) {
    return {
        get direction() {
            return xmlStanza.ns_x4m_in::meta.@direction.toString();
        },

        get account() {
            return xmlStanza.ns_x4m_in::meta.@account.toString();
        },

        get stanza() {
            return xmlStanza;
        },

        get event() {
            return xmlStanza.name().localName;
        }
    }
};

XMPP.get = function() {
    var localRequest = stanza.ns_x4m_in::query;
    if(localRequest.@type == 'presence') {
        let reply =
            <iq type='result' from={account}>
            <query xmlns={ns_x4m_in}/>
            </iq>;

        let presences = XMPP.cache
            .all(XMPP.q()
                 .event('presence')
                 .direction('in')
                 .account(account));

        for each(var presence in presences) {
            reply.ns_x4m_in::query.appendChild(presence.stanza);
        }

        replyHandler(reply);
        return;
    }
};

XMPP.view = function(name) {
    // These should be pre-generated.  But just for prototyping, we
    // derive them from the cache or other means.
    switch(name) {
    case ns_roster:
        return {
            get: function(uri) {
                return XMPP.cache.first(
                    XMPP.q()
                        .event('iq')
                        .direction('in')
                        .account(XMPP.entity(uri).account)
                        .child(ns_roster, 'query'));
            }
        }
        break;
    case 'presence/in/account':
        return {
            get: function(account) {
                return XMPP.cache.all(
                    XMPP.q()
                        .event('presence')
                        .direction('in')
                        .account(account));
            }
        }
        break;

// XMPP.view(ns_roster)
//     .get('xmpp://' + account + '/' + address);
// XMPP.view(ns_vcard)
//     .get('xmpp://' + account + '/' + address);
// XMPP.view('presence')
//     .get('xmpp://' + account + '/' + address);
// XMPP.view(ns_bookmarks)

// XMPP.view('muc')
//     .get('')

// for each(var bookmark in XMPP.view(ns_bookmarks)) {

// }

    }
};